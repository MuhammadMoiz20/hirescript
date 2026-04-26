"""Queue repository — pure functions over the jobs / job_events tables.

Hand-rolled Postgres queue using ``SELECT ... FOR UPDATE SKIP LOCKED``. Workers
call :func:`claim_one` to atomically grab the next queued job. The API calls
:func:`cancel_job` to mark a queued/running job as cancelled. :func:`emit_event`
appends a row to ``job_events`` (used by SSE in later tasks).

The Postgres path uses raw SQL with ``FOR UPDATE SKIP LOCKED``. A SQLite
fallback exists purely to support the in-memory test fixture; production always
runs Postgres.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, JobEvent

SessionFactory = Callable[[], AsyncSession]


_PG_CLAIM_SQL = text(
    """
    UPDATE jobs
       SET status='running',
           worker_id=:wid,
           started_at=now(),
           heartbeat_at=now(),
           attempts=attempts+1
     WHERE id = (
        SELECT id FROM jobs
         WHERE status='queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
     )
     RETURNING id
    """
)


def _dialect_name(session: AsyncSession) -> str:
    bind = session.bind
    if bind is None:
        return "postgresql"
    return bind.dialect.name


async def claim_one(sf: SessionFactory, worker_id: str) -> Job | None:
    """Atomically claim the oldest queued job and mark it running.

    Returns the claimed :class:`Job` or ``None`` if the queue is empty / all
    candidate rows are locked by other workers.
    """
    async with sf() as s:
        if _dialect_name(s) == "postgresql":
            row = (await s.execute(_PG_CLAIM_SQL, {"wid": worker_id})).first()
            if row is None:
                await s.commit()
                return None
            job = (await s.execute(select(Job).where(Job.id == row.id))).scalar_one()
            await s.commit()
            return job

        # SQLite fallback — optimistic CAS on status='queued'. Combined with
        # aiosqlite's per-connection write serialization this gives the
        # "exactly one wins" guarantee the concurrency test relies on.
        candidate = (
            await s.execute(
                select(Job)
                .where(Job.status == "queued")
                .order_by(Job.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if candidate is None:
            await s.commit()
            return None
        now = datetime.now(timezone.utc)
        res = await s.execute(
            update(Job)
            .where(Job.id == candidate.id, Job.status == "queued")
            .values(
                status="running",
                worker_id=worker_id,
                started_at=now,
                heartbeat_at=now,
                attempts=Job.attempts + 1,
            )
        )
        if (res.rowcount or 0) == 0:
            await s.commit()
            return None
        job = (await s.execute(select(Job).where(Job.id == candidate.id))).scalar_one()
        await s.commit()
        return job


async def reclaim_stale_jobs(sf: SessionFactory, after_seconds: int = 60) -> int:
    """Return jobs to the queue if their heartbeat is older than ``after_seconds``.

    Returns the number of rows reset.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=after_seconds)
    async with sf() as s:
        res = await s.execute(
            update(Job)
            .where(Job.status == "running", Job.heartbeat_at < cutoff)
            .values(status="queued", worker_id=None, started_at=None, heartbeat_at=None)
        )
        await s.commit()
        return res.rowcount or 0


async def emit_event(
    sf: SessionFactory,
    job_id: uuid.UUID,
    *,
    phase: str,
    message: str | None,
    data: dict[str, Any] | None,
) -> None:
    """Append a JobEvent row for ``job_id``."""
    async with sf() as s:
        s.add(JobEvent(job_id=job_id, phase=phase, message=message, data=data))
        await s.commit()


async def cancel_job(sf: SessionFactory, job_id: uuid.UUID) -> bool:
    """Mark a queued or running job as cancelled. Returns True if a row changed."""
    async with sf() as s:
        res = await s.execute(
            update(Job)
            .where(Job.id == job_id, Job.status.in_(["queued", "running"]))
            .values(status="cancelled", finished_at=datetime.now(timezone.utc))
        )
        await s.commit()
        return (res.rowcount or 0) > 0
