"""Browser-agent submit fallback (B-mode only).

When no deterministic adapter exists for a posting's source, the runner
delegates here. We open a Playwright browser, build a system prompt that
carries:

- the identity-honesty invariant ("never submit under a name that isn't
  the candidate's"),
- the candidate profile JSON,
- the tailored resume PDF path,
- the JD text,
- the rule "you MUST stop before clicking final submit and emit
  ``{action: \"awaiting_user_confirmation\", screenshot_path, form_summary}``",

then ask :func:`claude_agent_sdk.query` for a JSON action plan over the
:mod:`agent_tools` whitelist. Each tool call is dispatched against the
Playwright ``Page``; results are emitted via ``on_progress`` so the
runner's existing JobEvent stream surfaces them in the review queue.

**B-mode only this slice.** The contract REQUIRES the model's plan to end
in an ``awaiting_user_confirmation`` action; if it doesn't, the run is
aborted and the application is parked errored. The user clicks confirm
in the review queue (Task 6) to drive the final submit step.

Hard caps per session: 40 tool calls, 5 minutes wall-clock. These are
enforced by the loop here, not advisory in the prompt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, TypedDict

from app.services.submit_adapters.agent_tools import TOOLS

logger = logging.getLogger(__name__)


class AgentSubmitResult(TypedDict, total=False):
    """Outcome of a browser-agent submit attempt.

    ``awaiting_user_confirmation`` is True when the agent has driven the
    form to the brink of submit but stopped at the confirmation gate —
    the runner persists artifacts and parks the application in
    ``status='awaiting_confirmation'`` until the user confirms via
    :func:`app.routes.applications.confirm_submit`.
    """

    awaiting_user_confirmation: bool
    agent_session_id: str
    screenshot_path: str
    form_summary: str
    confirmation_html: str
    confirmation_screenshot_path: str
    submitted_at: datetime


_MAX_TOOL_CALLS = 40
_MAX_WALL_SEC = 300
_DEFAULT_SCREENSHOT_DIR = "/app/compiled_pdfs/submit_screenshots"


_SYSTEM_PROMPT_TEMPLATE = """You are HireScript's browser-agent submit \
fallback. You drive a real Playwright browser session to fill a job \
application form. You MUST obey these invariants:

1. IDENTITY HONESTY: You may only submit the application under the \
candidate's real name. Never modify the legal name to better match a JD. \
If the form requires information you cannot truthfully provide, stop and \
emit `awaiting_user_confirmation` so the user can intervene.

2. STOP BEFORE FINAL SUBMIT: You are FORBIDDEN from clicking the final \
"Submit application" / "Apply" button. The user reviews + confirms via the \
review queue. Your last action MUST be \
`{{"action": "awaiting_user_confirmation", "screenshot_path": "<path>", \
"form_summary": "<plain-text recap of the fields you filled>"}}`.

3. ONE PAGE RULE: The resume PDF is already enforced one-page; do not \
upload a different file.

Available tools (call by name with the listed params):
- navigate(url)
- snapshot()                         -> coarse page text
- click(selector)                    -> rejects selectors matching submit
- fill(selector, value)
- upload(selector, path)
- screenshot(path?, application_id?) -> writes a PNG to disk

Respond with EXACTLY ONE fenced JSON object:
```json
{{
  "actions": [{{"tool": "navigate", "params": {{"url": "..."}}}}, ...],
  "final": {{"action": "awaiting_user_confirmation",
            "screenshot_path": "<path>",
            "form_summary": "<text>"}}
}}
```

Candidate profile JSON: {profile_json}
Resume PDF path: {resume_pdf_path}
Job description (truncated): {jd_excerpt}
Apply URL: {apply_url}
"""


def _build_system_prompt(ctx: dict[str, Any]) -> str:
    profile = {
        "first_name": ctx.get("profile_first_name", ""),
        "last_name": ctx.get("profile_last_name", ""),
        "email": ctx.get("profile_email", ""),
        "phone": ctx.get("profile_phone", ""),
        "links": ctx.get("profile_links", {}),
    }
    jd = (ctx.get("jd_excerpt") or "")[:2000]
    return _SYSTEM_PROMPT_TEMPLATE.format(
        profile_json=json.dumps(profile),
        resume_pdf_path=ctx.get("resume_pdf_path", ""),
        jd_excerpt=jd,
        apply_url=ctx.get("posting_apply_url", ""),
    )


async def _query_agent_plan(
    *, system_prompt: str, user_prompt: str
) -> dict[str, Any]:
    """Single-shot call into ``claude_agent_sdk.query`` returning the parsed
    JSON action plan. Imported lazily so tests can monkeypatch this module
    without paying the SDK import cost.
    """
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        TextBlock,
        query,
    )

    options = ClaudeAgentOptions(
        model="claude-sonnet-4-6",
        system_prompt=system_prompt,
    )
    collected: list[str] = []
    async for msg in query(prompt=user_prompt, options=options):
        if not isinstance(msg, AssistantMessage):
            continue
        for block in msg.content:
            if isinstance(block, TextBlock):
                collected.append(block.text)
    raw = "".join(collected).strip()
    if not raw:
        raise RuntimeError("agent returned no text")
    # Strip ```json fences if present.
    if raw.startswith("```"):
        raw = "\n".join(
            line for line in raw.splitlines() if not line.startswith("```")
        ).strip()
    return json.loads(raw)


async def _emit(
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None,
    phase: str,
    **data: Any,
) -> None:
    if on_progress is None:
        return
    try:
        await on_progress({"phase": phase, **data})
    except Exception:  # noqa: BLE001
        logger.exception("on_progress raised for %s", phase)


async def run(
    ctx: dict[str, Any],
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
) -> AgentSubmitResult:
    """Drive the browser-agent submit flow.

    Returns an :class:`AgentSubmitResult` with
    ``awaiting_user_confirmation=True`` when the agent paused before final
    submit (the only acceptable terminal state in this slice). Raises
    ``RuntimeError`` if the agent's envelope is missing the required final
    action — we refuse to silently submit without the user gate.
    """
    from playwright.async_api import async_playwright

    out_dir = screenshot_dir or _DEFAULT_SCREENSHOT_DIR
    os.makedirs(out_dir, exist_ok=True)
    session_id = uuid.uuid4().hex
    deadline = time.monotonic() + _MAX_WALL_SEC

    system_prompt = _build_system_prompt(ctx)
    user_prompt = (
        f"Fill the application form at {ctx.get('posting_apply_url', '')} "
        f"using the profile + resume above. Stop before clicking final submit."
    )

    await _emit(
        on_progress, "agent_started", session_id=session_id,
        url=ctx.get("posting_apply_url", ""),
    )

    plan = await _query_agent_plan(
        system_prompt=system_prompt, user_prompt=user_prompt
    )

    actions = plan.get("actions") or []
    final = plan.get("final") or {}
    if final.get("action") != "awaiting_user_confirmation":
        raise RuntimeError(
            "agent envelope missing required "
            "awaiting_user_confirmation final action"
        )
    if len(actions) > _MAX_TOOL_CALLS:
        raise RuntimeError(
            f"agent plan exceeds tool-call cap "
            f"({len(actions)} > {_MAX_TOOL_CALLS})"
        )

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context()
            page = await context.new_page()

            for i, step in enumerate(actions):
                if time.monotonic() > deadline:
                    raise RuntimeError(
                        f"agent session exceeded wall-clock cap "
                        f"({_MAX_WALL_SEC}s)"
                    )
                tool_name = step.get("tool", "")
                params = dict(step.get("params") or {})
                handler = TOOLS.get(tool_name)
                if handler is None:
                    await _emit(
                        on_progress, "agent_tool_unknown",
                        tool=tool_name, step=i,
                    )
                    continue
                # Inject application_id into screenshot calls so the
                # default-path heuristic can name the file.
                if tool_name == "screenshot":
                    params.setdefault(
                        "application_id", ctx.get("application_id", 0)
                    )
                try:
                    out = await handler(page, params)
                except Exception as exc:  # noqa: BLE001
                    out = {"ok": False, "error": str(exc)[:200]}
                await _emit(
                    on_progress, "agent_tool_call",
                    step=i, tool=tool_name, result=out,
                )

            # Final pause screenshot — if the agent didn't supply one, we
            # capture one ourselves so the review queue always has an
            # artifact to render.
            screenshot_path = final.get("screenshot_path") or os.path.join(
                out_dir,
                f"agent_pause_{ctx.get('application_id', 0)}_"
                f"{int(time.monotonic())}.png",
            )
            try:
                await page.screenshot(path=screenshot_path, full_page=True)
            except Exception:  # noqa: BLE001
                logger.exception("agent final screenshot failed")

            form_summary = str(final.get("form_summary", ""))[:2000]
            await _emit(
                on_progress, "agent_awaiting_user_confirmation",
                session_id=session_id, screenshot_path=screenshot_path,
            )

            return AgentSubmitResult(
                awaiting_user_confirmation=True,
                agent_session_id=session_id,
                screenshot_path=screenshot_path,
                form_summary=form_summary,
            )
        finally:
            await browser.close()


__all__ = ["AgentSubmitResult", "run"]


# Re-export so ``hasattr(asyncio, "to_thread")``-style checks pass on cold
# imports — defensive: agent_submit currently doesn't use asyncio.to_thread,
# but the import keeps the namespace stable for follow-up slices.
_ = asyncio
