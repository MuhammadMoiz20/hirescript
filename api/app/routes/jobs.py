import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import SessionLocal, get_db
from app.models import Job, JobEvent
from app.schemas import (
    EnqueueTailorIn,
    EnqueueTailorOut,
    JobListOut,
    JobOut,
)

_TERMINAL_PHASES = ("done", "failed", "cancelled")
_POLL_INTERVAL_SECONDS = 0.5

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("/tailor", response_model=EnqueueTailorOut)
async def enqueue_tailor(
    body: EnqueueTailorIn,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.items:
        raise HTTPException(400, "items required")
    batch_id = uuid.uuid4()
    jobs: list[Job] = []
    for item in body.items:
        j = Job(
            kind="tailor",
            status="queued",
            batch_id=batch_id,
            payload={
                "resume_id": body.resume_id,
                "jd_text": item.jd_text,
                "title": item.title,
                "company": item.company,
                "url": item.url,
                "deep": body.deep,
            },
        )
        db.add(j)
        jobs.append(j)
    await db.commit()
    for j in jobs:
        await db.refresh(j)
    return EnqueueTailorOut(batch_id=batch_id, job_ids=[j.id for j in jobs])


@router.get("", response_model=JobListOut)
async def list_jobs(
    status: str | None = None,
    batch_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Job).order_by(Job.created_at.desc())
    if status:
        stmt = stmt.where(Job.status.in_(status.split(",")))
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(stmt.limit(limit).offset(offset))
    ).scalars().all()
    return JobListOut(
        items=[JobOut.model_validate(r) for r in rows], total=total
    )


@router.get("/{job_id}/events")
async def stream_job_events(
    job_id: uuid.UUID,
    cursor: int = 0,
    user_id: int = Depends(require_user),
):
    """Server-sent events stream of `job_events` rows for a job.

    Polls every 500ms for rows with id > last seen. Emits `event: phase`
    for non-terminal events, and `event: <terminal>` for terminal phases
    (`done`, `failed`, `cancelled`), then ends the stream.

    Each request opens its own short-lived AsyncSession per poll so the
    connection isn't held across the entire stream lifetime.
    """

    async def gen():
        last = cursor
        terminal = False
        while not terminal:
            async with SessionLocal() as session:
                rows = (
                    await session.execute(
                        select(JobEvent)
                        .where(JobEvent.job_id == job_id, JobEvent.id > last)
                        .order_by(JobEvent.id)
                    )
                ).scalars().all()
            for ev in rows:
                last = ev.id
                if ev.phase in _TERMINAL_PHASES:
                    yield (
                        f"event: {ev.phase}\n"
                        f"data: {json.dumps(ev.data or {})}\n\n"
                    )
                    terminal = True
                else:
                    payload = {
                        "phase": ev.phase,
                        "message": ev.message,
                        "data": ev.data,
                    }
                    yield f"event: phase\ndata: {json.dumps(payload)}\n\n"
            if terminal:
                break
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: uuid.UUID,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    job = (
        await db.execute(select(Job).where(Job.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise HTTPException(404)
    return JobOut.model_validate(job)
