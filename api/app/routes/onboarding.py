"""Onboarding chat route.

Streams one assistant turn from ``app.services.onboarding`` over Server-Sent
Events, mirroring the SSE pattern in ``routes/resumes.py``. Tool calls run
inline against the request-scoped DB session so every write commits before
the response finishes — the UI can then re-fetch the profile / KB sources to
reflect the agent's edits.

Slice 1 keeps history client-side: the request body carries the full prior
``history`` list each turn, so there's no server-side conversation table.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.services.onboarding import (
    event_to_sse,
    run_onboarding_turn,
)


router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class OnboardingTurn(BaseModel):
    role: str
    content: str


class OnboardingMessageRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: list[OnboardingTurn] = Field(default_factory=list)


@router.post("/message")
async def onboarding_message(
    body: OnboardingMessageRequest,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    history = [t.model_dump() for t in body.history]

    async def event_stream():
        try:
            async for event in run_onboarding_turn(
                db=db,
                user_id=user_id,
                message=body.message,
                history=history,
            ):
                yield event_to_sse(event)
        except Exception as exc:  # pragma: no cover - defensive
            # Surface a final error frame so the client always sees a
            # well-formed terminal pair (error + done) instead of a dropped
            # connection mid-stream.
            yield event_to_sse({"type": "error", "error": str(exc)[:500]})
        # Terminator so the client can detect a clean end-of-stream.
        yield event_to_sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
