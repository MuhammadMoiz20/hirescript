"""Playwright tool surface for the browser-agent submit fallback.

These are the primitive operations the agent is allowed to perform on a
Playwright ``Page``. Keeping them in their own module makes the tool
surface auditable in isolation: anything outside this whitelist is a bug.

Each tool is async, takes the page + a parameters dict, and returns a
small JSON-serialisable result describing what happened (or what was
observed). The agent loop in :mod:`agent_submit` enforces the per-session
caps (max 40 calls, 5min wall-clock) — tools themselves are stateless.

Importantly, NONE of these tools clicks a "submit" / "apply" button. The
agent is required to stop before the final submit and emit
``{action: "awaiting_user_confirmation", ...}``; the user confirms via
:func:`app.routes.applications.confirm_submit` (Task 6) which re-opens
the persisted Playwright session and clicks submit. This module
deliberately does not expose a ``final_submit`` tool so a malformed
envelope cannot accidentally fire one.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


async def navigate(page: Any, params: dict[str, Any]) -> dict[str, Any]:
    """Navigate to ``params['url']``. Returns ``{ok, url, title}``."""
    url = params["url"]
    await page.goto(url, timeout=30_000)
    try:
        title = await page.title()
    except Exception:  # noqa: BLE001
        title = ""
    return {"ok": True, "url": page.url, "title": title}


async def snapshot(page: Any, params: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG001
    """Return a coarse text snapshot of the page so the agent can decide
    what to do next without asking for full HTML on every step."""
    try:
        text = await page.evaluate(
            "() => (document.body && document.body.innerText || '').slice(0, 4000)"
        )
    except Exception:  # noqa: BLE001
        text = ""
    return {"ok": True, "url": page.url, "text": text}


async def click(page: Any, params: dict[str, Any]) -> dict[str, Any]:
    """Click ``params['selector']``. Refuses selectors that look like a
    final-submit button — the agent must not press the submit gate
    itself; the user owns that click via the review-queue confirm flow."""
    sel = params["selector"]
    if _looks_like_final_submit(sel):
        return {
            "ok": False,
            "error": "refused: final-submit selectors are gated by the user",
            "selector": sel,
        }
    loc = page.locator(sel).first
    await loc.click()
    return {"ok": True, "selector": sel}


async def fill(page: Any, params: dict[str, Any]) -> dict[str, Any]:
    sel = params["selector"]
    value = params.get("value", "")
    loc = page.locator(sel).first
    await loc.fill(value)
    return {"ok": True, "selector": sel}


async def upload(page: Any, params: dict[str, Any]) -> dict[str, Any]:
    """Attach a file at ``params['path']`` to ``params['selector']``."""
    sel = params["selector"]
    path = params["path"]
    if not os.path.exists(path):
        return {"ok": False, "error": f"path does not exist: {path}"}
    loc = page.locator(sel).first
    await loc.set_input_files(path)
    return {"ok": True, "selector": sel, "path": path}


async def screenshot(page: Any, params: dict[str, Any]) -> dict[str, Any]:
    """Capture a full-page PNG to ``params['path']`` (or a default location)."""
    out = params.get("path") or _default_screenshot_path(
        params.get("application_id", 0)
    )
    os.makedirs(os.path.dirname(out), exist_ok=True)
    await page.screenshot(path=out, full_page=True)
    return {"ok": True, "path": out}


# Tool registry consumed by :func:`agent_submit.run`. Each handler takes
# ``(page, params) -> dict``. Adding a tool means adding it here AND to
# the agent's system prompt — the model can't call what isn't enumerated.
TOOLS = {
    "navigate": navigate,
    "snapshot": snapshot,
    "click": click,
    "fill": fill,
    "upload": upload,
    "screenshot": screenshot,
}


_FINAL_SUBMIT_HINTS = (
    "submit-application",
    "btn-submit",
    "submit_button",
    "[type='submit']",
    "[type=\"submit\"]",
    'button[type=submit]',
)


def _looks_like_final_submit(sel: str) -> bool:
    """Best-effort guard against the agent firing the final submit click.

    The user owns the final-submit step via the review-queue confirm flow.
    The check is intentionally conservative — false negatives are caught
    by the agent loop's required ``awaiting_user_confirmation`` envelope
    (no envelope, no completion).
    """
    s = (sel or "").lower()
    return any(hint in s for hint in _FINAL_SUBMIT_HINTS)


def _default_screenshot_path(application_id: int) -> str:
    ts = int(datetime.now(timezone.utc).timestamp())
    return f"/app/compiled_pdfs/submit_screenshots/agent_{application_id}_{ts}.png"


__all__ = ["TOOLS", "click", "fill", "navigate", "screenshot", "snapshot", "upload"]
