"""Claude client/model dispatcher.

All Anthropic traffic goes through the **Max** client (Agent SDK; the local
``claude`` CLI auth backs ``claude_agent_sdk.query``). The legacy API-key
client has been removed — we no longer require ``ANTHROPIC_API_KEY``.

Routing decisions live in :func:`choose`. The caller fetches the actual SDK
client via :func:`get_max_client`. After every call the caller is expected
to invoke :func:`record_usage` so the rolling window load stays observable.

This module is the single source of truth for "which model do we hit for
which task". Existing services (``classify``, ``tailor``, ``cover_letter``,
``verify``) call into here so we can re-tune the policy from one place.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Literal, TypedDict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClaudeUsage, Tier


TaskKind = Literal["tailor", "classify", "verify", "cover_letter", "research"]
ClientName = Literal["max", "api"]

_VALID_TASK_KINDS: set[str] = {
    "tailor",
    "classify",
    "verify",
    "cover_letter",
    "research",
}

# Map the human-friendly tier slugs stored in `Tier.tailor_model` to actual
# Anthropic model IDs.
_TIER_MODEL_TO_MODEL_ID: dict[str, str] = {
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.7": "claude-opus-4-7",
    "haiku-4.5": "claude-haiku-4-5",
}

_HAIKU_MODEL = "claude-haiku-4-5"
_SONNET_MODEL = "claude-sonnet-4-6"

_DEFAULT_MAX_WINDOW_BUDGET = 4_000_000


class ClientChoice(TypedDict):
    client: ClientName
    model: str


class WindowExhaustedError(RuntimeError):
    """Retained for backward compatibility. No longer raised by :func:`choose`
    now that all tasks route through Max unconditionally."""


# --- lazy SDK client singletons -----------------------------------------------


def get_api_client():
    """Removed. Kept as an importable symbol so any straggler that still tries
    to dispatch through an API-key client fails loudly at call time rather
    than at import time.
    """
    raise RuntimeError(
        "API-key client removed; all calls go through Max via Agent SDK"
    )


def get_max_client():
    """Return the Agent SDK module used as the Max-plan client.

    The Agent SDK exposes a top-level ``query`` coroutine rather than a class,
    so "the client" is just the module itself. We expose this as a function so
    tests can monkeypatch a fake without touching the real SDK.
    """
    from app.services import agent  # re-export the module

    return agent


# --- usage recording + window load --------------------------------------------


async def record_usage(
    db: AsyncSession,
    *,
    client: ClientName,
    model: str,
    task_kind: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Append one row to ``claude_usage``.

    Best-effort accounting — callers should not let a failure here mask the
    underlying model call result. We commit so the rolling counter sees the
    row even if the calling transaction rolls back.
    """
    db.add(
        ClaudeUsage(
            client=client,
            model=model,
            task_kind=task_kind,
            input_tokens=int(input_tokens or 0),
            output_tokens=int(output_tokens or 0),
        )
    )
    await db.commit()


async def max_window_load(db: AsyncSession) -> float:
    """Return how full the rolling 5-hour Max-plan token window is.

    Sums ``input_tokens + output_tokens`` from rows in ``claude_usage`` where
    ``client='max'`` and ``started_at >= now() - 5 hours``. Divides by the
    ``MAX_WINDOW_TOKEN_BUDGET`` env var (default 4_000_000). Result is clamped
    to ``[0.0, 1.0]`` for observability — :func:`choose` no longer routes on
    this value, but callers/dashboards may still consult it.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=5)
    stmt = select(
        func.coalesce(
            func.sum(ClaudeUsage.input_tokens + ClaudeUsage.output_tokens),
            0,
        )
    ).where(
        ClaudeUsage.client == "max",
        ClaudeUsage.started_at >= cutoff,
    )
    used = int((await db.execute(stmt)).scalar() or 0)
    budget = int(os.environ.get("MAX_WINDOW_TOKEN_BUDGET", _DEFAULT_MAX_WINDOW_BUDGET))
    if budget <= 0:
        return 1.0
    return max(0.0, min(1.0, used / budget))


# --- routing ------------------------------------------------------------------


async def _tailor_model_for_tier(
    db: AsyncSession, tier_slug: str | None
) -> str:
    """Resolve a tier slug to an Anthropic model ID for the tailor path.

    Falls back to Sonnet 4.6 if ``tier_slug`` is None or the row is missing
    or carries an unknown ``tailor_model`` value.
    """
    if not tier_slug:
        return _SONNET_MODEL
    row = (
        await db.execute(select(Tier).where(Tier.slug == tier_slug))
    ).scalar_one_or_none()
    if row is None:
        return _SONNET_MODEL
    return _TIER_MODEL_TO_MODEL_ID.get(row.tailor_model, _SONNET_MODEL)


async def choose(
    db: AsyncSession,
    *,
    task_kind: TaskKind,
    tier_slug: str | None = None,
) -> ClientChoice:
    """Pick the (client, model) pair for a task.

    All tasks now run on Max via the Agent SDK. Routing rules:

    - ``classify``, ``cover_letter``, ``verify`` → Max + Haiku 4.5.
    - ``tailor`` → Max + per-tier model (Sonnet default).
    - ``research`` → Max + Sonnet.
    """
    if task_kind not in _VALID_TASK_KINDS:
        raise ValueError(f"unknown task_kind: {task_kind!r}")

    if task_kind in ("classify", "cover_letter", "verify"):
        return ClientChoice(client="max", model=_HAIKU_MODEL)

    if task_kind == "tailor":
        return ClientChoice(
            client="max",
            model=await _tailor_model_for_tier(db, tier_slug),
        )

    # research
    return ClientChoice(client="max", model=_SONNET_MODEL)


__all__ = [
    "ClientChoice",
    "TaskKind",
    "WindowExhaustedError",
    "choose",
    "get_api_client",
    "get_max_client",
    "max_window_load",
    "record_usage",
]
