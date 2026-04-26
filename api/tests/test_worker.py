"""Tests for the background worker supervisor loop."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.models import Job


@pytest.mark.asyncio
async def test_worker_drains_one_job(
    monkeypatch, sessionmaker_factory, seeded_master_resume
):
    from app.services import jobs_runner

    calls: list[int] = []

    async def fake_run(sf, jid):
        calls.append(jid)
        async with sf() as s:
            await s.execute(
                update(Job).where(Job.id == jid).values(status="succeeded")
            )
            await s.commit()

    monkeypatch.setattr(jobs_runner, "run_tailor_job", fake_run)

    async with sessionmaker_factory() as s:
        job = Job(
            kind="tailor",
            status="queued",
            payload={
                "resume_id": seeded_master_resume.id,
                "jd_text": "x",
                "title": "t",
                "company": "c",
                "url": None,
                "deep": False,
            },
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        jid = job.id

    from app.worker import run_until_idle

    await run_until_idle(
        sessionmaker_factory,
        worker_id="w-test",
        concurrency=2,
        max_idle_polls=2,
        poll_sec=0.05,
    )
    assert jid in calls

    async with sessionmaker_factory() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
