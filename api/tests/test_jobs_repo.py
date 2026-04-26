import asyncio
import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from app.models import Job, JobEvent
from app.services.jobs_repo import claim_one, reclaim_stale_jobs, emit_event, cancel_job


@pytest.mark.asyncio
async def test_claim_one_returns_queued_and_marks_running(db_session, sessionmaker_factory):
    job = Job(kind="tailor", payload={}, status="queued")
    db_session.add(job)
    await db_session.commit()

    claimed = await claim_one(sessionmaker_factory, worker_id="w-1")
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == "running"
    assert claimed.worker_id == "w-1"

    again = await claim_one(sessionmaker_factory, worker_id="w-2")
    assert again is None


@pytest.mark.asyncio
async def test_claim_one_concurrent_only_one_wins(sessionmaker_factory):
    async with sessionmaker_factory() as s:
        s.add(Job(kind="tailor", payload={}, status="queued"))
        await s.commit()

    results = await asyncio.gather(*[
        claim_one(sessionmaker_factory, worker_id=f"w-{i}") for i in range(10)
    ])
    winners = [r for r in results if r is not None]
    assert len(winners) == 1


@pytest.mark.asyncio
async def test_reclaim_stale_jobs(sessionmaker_factory, db_session):
    job = Job(
        kind="tailor",
        payload={},
        status="running",
        worker_id="dead",
        heartbeat_at=datetime.now(timezone.utc) - timedelta(seconds=120),
    )
    db_session.add(job)
    await db_session.commit()
    n = await reclaim_stale_jobs(sessionmaker_factory, after_seconds=60)
    assert n == 1
    await db_session.refresh(job)
    assert job.status == "queued"
    assert job.worker_id is None


@pytest.mark.asyncio
async def test_emit_event_appends(sessionmaker_factory, db_session):
    job = Job(kind="tailor", payload={}, status="running")
    db_session.add(job)
    await db_session.commit()
    await emit_event(
        sessionmaker_factory,
        job.id,
        phase="draft_start",
        message=None,
        data={"tier": "sonnet"},
    )
    rows = (
        await db_session.execute(select(JobEvent).where(JobEvent.job_id == job.id))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].phase == "draft_start"


@pytest.mark.asyncio
async def test_cancel_only_cancels_active(sessionmaker_factory, db_session):
    j1 = Job(kind="tailor", payload={}, status="queued")
    j2 = Job(kind="tailor", payload={}, status="succeeded")
    db_session.add_all([j1, j2])
    await db_session.commit()
    assert await cancel_job(sessionmaker_factory, j1.id) is True
    assert await cancel_job(sessionmaker_factory, j2.id) is False
    await db_session.refresh(j1)
    assert j1.status == "cancelled"
