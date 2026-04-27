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

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Application, Job, JobEvent, JobPosting

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

        # SQLite fallback — correctness comes from the optimistic CAS clause
        # `WHERE id=... AND status='queued'`: a second writer's UPDATE matches
        # zero rows. The shared-cache StaticPool used by tests serializes
        # writes on a single connection; production uses Postgres above.
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


async def enqueue_ingest_source(
    db: AsyncSession, *, source: str, company_slug: str
) -> uuid.UUID:
    """Insert a queued ``ingest_source`` job for ``(source, company_slug)``.

    The runner looks up the adapter via :data:`app.services.sources.SOURCES`
    so any registered source can be ingested through this single kind. The
    caller owns the transaction (we only ``flush``); returns the new job id.
    """
    job_id = uuid.uuid4()
    db.add(
        Job(
            id=job_id,
            kind="ingest_source",
            status="queued",
            payload={"source": source, "company_slug": company_slug},
        )
    )
    await db.flush()
    return job_id


async def enqueue_ingest_greenhouse(
    db: AsyncSession, *, company_slug: str
) -> uuid.UUID:
    """Backwards-compat wrapper retained for slice-4 Batch A.

    The scheduler still calls this until Batch B Task 8 teaches it to
    iterate the SOURCES registry. New call sites should prefer
    :func:`enqueue_ingest_source` directly. The legacy ``ingest_greenhouse``
    job kind also remains in :data:`RUNNERS` for one slice of compat.
    """
    job_id = uuid.uuid4()
    db.add(
        Job(
            id=job_id,
            kind="ingest_greenhouse",
            status="queued",
            payload={"company_slug": company_slug},
        )
    )
    await db.flush()
    return job_id


async def enqueue_ingest_gmail(db: AsyncSession) -> uuid.UUID:
    """Insert a queued ``ingest_gmail`` job (single-tenant, no params).

    Caller owns the transaction (we only ``flush``); returns the new
    job id. The runner reads ``user_id=1`` directly per the
    single-tenant phase.
    """
    job_id = uuid.uuid4()
    db.add(
        Job(
            id=job_id,
            kind="ingest_gmail",
            status="queued",
            payload={},
        )
    )
    await db.flush()
    return job_id


async def enqueue_classify_posting(
    db: AsyncSession, *, posting_id: int
) -> uuid.UUID:
    """Insert a queued ``classify_posting`` job for ``posting_id``.

    Caller owns the transaction (we only ``flush``); returns the new job id.
    """
    job_id = uuid.uuid4()
    db.add(
        Job(
            id=job_id,
            kind="classify_posting",
            status="queued",
            payload={"posting_id": posting_id},
        )
    )
    await db.flush()
    return job_id


async def enqueue_prepare_application(
    db: AsyncSession, *, posting_id: int
) -> uuid.UUID:
    """Insert a queued ``prepare_application`` job for ``posting_id``.

    Caller owns the transaction (we only ``flush``); returns the new job id.
    """
    job_id = uuid.uuid4()
    db.add(
        Job(
            id=job_id,
            kind="prepare_application",
            status="queued",
            payload={"posting_id": posting_id},
        )
    )
    await db.flush()
    return job_id


async def enqueue_submit_application(
    db: AsyncSession, *, application_id: int
) -> uuid.UUID:
    """Insert a queued ``submit_application`` job for ``application_id``.

    Caller owns the transaction (we only ``flush``); returns the new job id.
    """
    job_id = uuid.uuid4()
    db.add(
        Job(
            id=job_id,
            kind="submit_application",
            status="queued",
            payload={"application_id": application_id},
        )
    )
    await db.flush()
    return job_id


async def count_submitted_today_for_tier(
    db: AsyncSession, *, tier_slug: str
) -> int:
    """Return today's (UTC) submitted-application count for ``tier_slug``.

    Used by the autonomous-submit scheduler and the A-mode runner branch to
    enforce per-tier daily caps. Counts ``Application`` rows joined to
    ``JobPosting`` on ``posting_id`` where ``posting.tier == tier_slug`` AND
    ``status == 'submitted'`` AND ``submitted_at >= start of today UTC``.
    """
    now = datetime.now(timezone.utc)
    start_utc = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    stmt = (
        select(func.count(Application.id))
        .join(JobPosting, JobPosting.id == Application.posting_id)
        .where(
            JobPosting.tier == tier_slug,
            Application.status == "submitted",
            Application.submitted_at >= start_utc,
        )
    )
    val = (await db.execute(stmt)).scalar_one()
    return int(val or 0)


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
