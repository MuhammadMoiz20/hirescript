"""Claude client/model dispatcher.

Routes Anthropic calls between two clients:

- The **Max** client (Agent SDK; ``claude_agent_sdk.query``) — preferred for
  long-running model traffic that fits inside the user's Claude Max plan
  five-hour window.
- The **API-key** client (``anthropic.AsyncAnthropic``) — used for short
  utility calls (classify, cover_letter, verify) and as the overflow path
  when Max is saturated.

Routing decisions are intentionally simple and live in :func:`choose`. The
caller fetches the actual SDK client via :func:`get_max_client` /
:func:`get_api_client`. After every call the caller is expected to invoke
:func:`record_usage` so the rolling window load stays accurate.

This module is the single source of truth for "which model do we hit for
which task" and for the Max-vs-API split. Existing services (``classify``,
``tailor``, ``cover_letter``, ``verify``) call into here so we can re-tune
the policy from one place.
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
_MAX_WINDOW_FALLBACK_THRESHOLD = 0.85


class ClientChoice(TypedDict):
    client: ClientName
    model: str


class WindowExhaustedError(RuntimeError):
    """Raised when a task that has no fallback path runs into a saturated Max window."""


# --- lazy SDK client singletons -----------------------------------------------

_api_client_singleton = None


def get_api_client():
    """Return a process-global ``anthropic.AsyncAnthropic`` instance.

    Lazily constructed so importing this module never requires an API key —
    only callers that actually dispatch through the API client need one.
    """
    global _api_client_singleton
    if _api_client_singleton is None:
        import anthropic  # local import: keep module-import cheap

        _api_client_singleton = anthropic.AsyncAnthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"]
        )
    return _api_client_singleton


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
    to ``[0.0, 1.0]`` so a callers can compare against fixed thresholds.
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

    Routing rules:

    - ``classify``, ``cover_letter``, ``verify`` → API-key Haiku.
    - ``tailor`` → Max + per-tier model under budget; API-key Sonnet over
      ``_MAX_WINDOW_FALLBACK_THRESHOLD``.
    - ``research`` → Max + Sonnet under budget; raises
      :class:`WindowExhaustedError` over budget (no fallback).
    """
    if task_kind not in _VALID_TASK_KINDS:
        raise ValueError(f"unknown task_kind: {task_kind!r}")

    if task_kind in ("classify", "cover_letter", "verify"):
        return ClientChoice(client="api", model=_HAIKU_MODEL)

    if task_kind == "tailor":
        load = await max_window_load(db)
        if load > _MAX_WINDOW_FALLBACK_THRESHOLD:
            return ClientChoice(client="api", model=_SONNET_MODEL)
        return ClientChoice(
            client="max",
            model=await _tailor_model_for_tier(db, tier_slug),
        )

    # research
    load = await max_window_load(db)
    if load > _MAX_WINDOW_FALLBACK_THRESHOLD:
        raise WindowExhaustedError(
            f"max window load {load:.2f} exceeds threshold "
            f"{_MAX_WINDOW_FALLBACK_THRESHOLD}"
        )
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
