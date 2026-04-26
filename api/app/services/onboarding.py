"""Onboarding interview agent.

Slice 1 keeps this self-contained: an async generator that runs one assistant
turn against ``claude_agent_sdk.query`` and yields a stream of typed events
(text deltas, tool calls, errors). Tool dispatch happens in this module —
each ``ToolUseBlock`` emitted by the model is matched to one of three named
tools and executed against the request-scoped DB session. We commit inside
each tool so subsequent ``read_profile`` calls see the new state.

The three tools are:

- ``read_profile()`` — return the current profile JSON (or an empty shell).
- ``update_profile_fields(patch)`` — deep-merge ``patch`` into the existing
  profile, validate via the ``Profile`` Pydantic model, and persist via the
  same on-conflict upsert path used by ``PUT /profile``.
- ``add_kb_note(title, body)`` — ingest a free-form markdown note via the KB
  pipeline (chunks + embeds + stores under ``source="onboarding"``).

Routing/auth and the explicit Max vs API router are deferred to slice 3 — for
now we just call ``query`` with the Sonnet model id, mirroring ``agent.py``.
"""

from __future__ import annotations

import copy
import json
import uuid
from typing import AsyncIterator, TypedDict

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    ToolUseBlock,
    query,
)
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Profile as ProfileModel
from app.schemas.profile import Profile
from app.services.kb_ingest import ingest_document


SONNET_MODEL = "claude-sonnet-4-6"

EMPTY_PROFILE = {"legal_name": "", "email": "unset@example.com"}


SYSTEM_PROMPT = """\
You are interviewing Moiz to populate his job-application profile for an AI \
resume-tailoring system. Your job is to fill in the structured profile and to \
capture narrative answers as searchable knowledge-base notes for later \
tailoring.

You have three tools:
- `read_profile()` — read the current structured profile JSON.
- `update_profile_fields(patch)` — deep-merge a JSON patch into the profile. \
Use this for structured facts (legal_name, email, phone, links, work_auth, \
positions, education, languages, preferences, eeo, kill_list).
- `add_kb_note(title, body)` — store a free-form markdown note that will be \
chunked and embedded for later retrieval. Use this for anything narrative: \
why he left a role, what he liked/disliked, achievements, side projects, \
constraints. Do NOT store structured facts here — those go in \
`update_profile_fields`.

Rules:
1. Read the profile first to understand what's already known.
2. Identify the most important gap or ambiguity and ask ONE question at a \
time. Keep questions short and concrete.
3. Never invent values. If Moiz hasn't said something, don't write it. If a \
field would require guessing, ask instead.
4. When Moiz answers, immediately call the right tool(s) before responding \
in prose. Structured facts go to `update_profile_fields`; narrative goes to \
`add_kb_note`.
5. After saving, briefly confirm what you recorded and ask the next question. \
One question per turn.
"""


class OnboardingError(RuntimeError):
    """Raised for unrecoverable errors during an onboarding turn."""


class OnboardingEvent(TypedDict, total=False):
    type: str  # "text" | "tool_use" | "tool_result" | "tool_error" | "done"
    text: str
    tool: str
    input: dict
    result: dict
    error: str


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


async def _load_profile_data(db: AsyncSession, user_id: int) -> dict:
    row = (
        await db.execute(
            select(ProfileModel).where(ProfileModel.user_id == user_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return dict(EMPTY_PROFILE)
    return dict(row.data or {})


def _deep_merge(base: dict, patch: dict) -> dict:
    """Recursively merge ``patch`` into ``base``, returning a new dict.

    Lists are replaced wholesale, not appended — the agent should pass the
    full new list when it wants to modify one.
    """
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if (
            isinstance(value, dict)
            and isinstance(out.get(key), dict)
        ):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


async def read_profile_tool(
    args: dict, *, db: AsyncSession, user_id: int
) -> dict:
    """Tool: return the current profile JSON or an empty shell."""
    return await _load_profile_data(db, user_id)


async def update_profile_fields_tool(
    args: dict, *, db: AsyncSession, user_id: int
) -> dict:
    """Tool: deep-merge ``args['patch']`` into the profile and persist.

    Returns the updated profile JSON on success. Raises ``ValueError`` when
    the patch produces an invalid profile so the caller can surface the
    error back to the agent in-band.
    """
    if not isinstance(args, dict):
        raise ValueError("update_profile_fields requires an object argument")
    patch = args.get("patch")
    if not isinstance(patch, dict):
        raise ValueError("update_profile_fields requires a 'patch' object")

    current = await _load_profile_data(db, user_id)
    merged = _deep_merge(current, patch)
    try:
        validated = Profile.model_validate(merged)
    except ValidationError as exc:
        # Surface a compact error string back to the agent rather than 500.
        raise ValueError(f"invalid profile patch: {exc.errors()}") from exc

    data = validated.model_dump(mode="json")
    stmt = pg_insert(ProfileModel).values(user_id=user_id, data=data)
    stmt = stmt.on_conflict_do_update(
        index_elements=[ProfileModel.user_id],
        set_={"data": data, "updated_at": func.now()},
    )
    await db.execute(stmt)
    await db.commit()
    return data


async def add_kb_note_tool(
    args: dict, *, db: AsyncSession, user_id: int
) -> dict:
    """Tool: ingest a markdown note as a KB document with source=onboarding."""
    if not isinstance(args, dict):
        raise ValueError("add_kb_note requires an object argument")
    title = args.get("title")
    body = args.get("body")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("add_kb_note requires a non-empty 'title' string")
    if not isinstance(body, str) or not body.strip():
        raise ValueError("add_kb_note requires a non-empty 'body' string")

    source_id = str(uuid.uuid4())
    doc = await ingest_document(
        db,
        user_id=user_id,
        source="onboarding",
        source_id=source_id,
        title=title,
        raw_text=body,
        meta={"created_by": "onboarding"},
    )
    return {"document_id": doc.id, "title": doc.title, "source_id": source_id}


TOOL_HANDLERS = {
    "read_profile": read_profile_tool,
    "update_profile_fields": update_profile_fields_tool,
    "add_kb_note": add_kb_note_tool,
}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _format_history(history: list[dict] | None) -> str:
    if not history:
        return ""
    turns = history[-12:]
    lines = ["Prior conversation (most recent last):"]
    for t in turns:
        role = (t.get("role") or "").strip()
        content = (t.get("content") or "").strip()
        if not content:
            continue
        label = "User" if role == "user" else "Assistant"
        snippet = content if len(content) <= 1500 else content[:1500] + "…"
        lines.append(f"{label}: {snippet}")
    block = "\n".join(lines)
    if len(block) > 8000:
        block = block[-8000:]
    return block + "\n\n"


def _build_user_prompt(message: str, history: list[dict] | None) -> str:
    return f"{_format_history(history)}User: {message.strip()}\n"


async def _dispatch_tool(
    block: ToolUseBlock,
    *,
    db: AsyncSession,
    user_id: int,
) -> tuple[str, dict | None, str | None]:
    """Run one tool. Returns (event_type, result_or_none, error_or_none)."""
    handler = TOOL_HANDLERS.get(block.name)
    if handler is None:
        return ("tool_error", None, f"unknown tool: {block.name}")
    try:
        result = await handler(block.input or {}, db=db, user_id=user_id)
        return ("tool_result", result, None)
    except ValueError as exc:
        # Validation / shape errors — return in-band so the agent can recover.
        return ("tool_error", None, str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        return ("tool_error", None, f"{type(exc).__name__}: {exc}")


async def run_onboarding_turn(
    *,
    db: AsyncSession,
    user_id: int,
    message: str,
    history: list[dict] | None,
) -> AsyncIterator[OnboardingEvent]:
    """Run one onboarding turn against the model and yield typed events.

    Tool calls present in the streamed assistant message are dispatched
    inline; their results are emitted as ``tool_result`` / ``tool_error``
    events so the route can forward them as SSE for UI feedback. Each tool
    persists its own writes so a follow-up ``read_profile`` reflects the new
    state.

    For slice 1 we do NOT loop the model after a tool call: the test fixture
    drives both the tool calls and the final assistant text in a single
    streamed turn. Slice 3 wires the explicit router and SDK MCP server.
    """
    options = ClaudeAgentOptions(
        model=SONNET_MODEL,
        system_prompt=SYSTEM_PROMPT,
    )
    user_prompt = _build_user_prompt(message, history)

    try:
        async for msg in query(prompt=user_prompt, options=options):
            if not isinstance(msg, AssistantMessage):
                continue
            for block in msg.content:
                if isinstance(block, TextBlock):
                    if block.text:
                        yield {"type": "text", "text": block.text}
                elif isinstance(block, ToolUseBlock):
                    yield {
                        "type": "tool_use",
                        "tool": block.name,
                        "input": dict(block.input or {}),
                    }
                    event_type, result, error = await _dispatch_tool(
                        block, db=db, user_id=user_id
                    )
                    if event_type == "tool_result":
                        yield {
                            "type": "tool_result",
                            "tool": block.name,
                            "result": result or {},
                        }
                    else:
                        yield {
                            "type": "tool_error",
                            "tool": block.name,
                            "error": error or "tool failed",
                        }
    except OnboardingError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        yield {"type": "tool_error", "tool": "", "error": str(exc)[:500]}


def event_to_sse(event: OnboardingEvent) -> str:
    """Render an ``OnboardingEvent`` as an SSE frame for the route layer."""
    name = event.get("type", "message")
    data = {k: v for k, v in event.items() if k != "type"}
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


__all__ = [
    "OnboardingError",
    "OnboardingEvent",
    "SONNET_MODEL",
    "SYSTEM_PROMPT",
    "TOOL_HANDLERS",
    "add_kb_note_tool",
    "event_to_sse",
    "read_profile_tool",
    "run_onboarding_turn",
    "update_profile_fields_tool",
]
