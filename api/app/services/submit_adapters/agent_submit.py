"""Browser-agent submit fallback (B-mode only).

This module is a placeholder in Task 4 — the runner needs `agent_submit.run`
to exist so the dispatch fall-through compiles and tests can monkeypatch it.
Task 5 fills it in with the real claude-agent-sdk session, Playwright tool
surface, and the persisted-pause that lets the user confirm the final submit
from the review queue.

Until then ``run`` raises :class:`NotImplementedError`; the runner only
invokes it on the agent fallback path, which production code refuses to
take in A-mode (so an unconfigured environment cannot accidentally trigger
this stub against a live posting).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, TypedDict


class AgentSubmitResult(TypedDict, total=False):
    """Outcome of a browser-agent submit attempt.

    ``awaiting_user_confirmation`` is True when the agent has driven the
    form to the brink of submit but stopped at the confirmation gate —
    the runner must persist artifacts and park the application until the
    user confirms via :func:`app.routes.applications.confirm_submit`.
    """

    awaiting_user_confirmation: bool
    agent_session_id: str
    screenshot_path: str
    form_summary: str
    confirmation_html: str
    confirmation_screenshot_path: str


async def run(
    ctx: dict[str, Any],
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    *,
    screenshot_dir: str | None = None,
) -> AgentSubmitResult:
    """Drive the browser-agent submit flow.

    Stub — Task 5 implements the real flow. Tests can monkeypatch this
    function (``monkeypatch.setattr(agent_submit, "run", fake)``) to
    exercise the runner's dispatch logic without touching the SDK.
    """
    raise NotImplementedError(
        "agent_submit.run is a Task 4 stub; Task 5 wires the real "
        "claude-agent-sdk + Playwright session"
    )


__all__ = ["AgentSubmitResult", "run"]
