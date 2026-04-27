"""Tests for the ``ingest_gmail`` runner.

The runner is a thin wrapper over :func:`gmail_digest.poll_and_ingest`:
records the count via a ``progress`` event, marks the job ``succeeded``,
and on any exception marks it ``failed``. We monkeypatch the
orchestrator so no IMAP / Anthropic calls happen.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Job, JobEvent, User
from app.services import jobs_runner
from app.services.jobs_repo import enqueue_ingest_gmail
from app.services.sources import gmail_digest


async def _ensure_user(sm) -> None:
    async with sm() as s:
        existing = (
            await s.execute(select(User).where(User.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            s.add(User(id=1))
            await s.commit()


async def _drain(sm):
    from app.worker import run_until_idle

    await run_until_idle(
        sm,
        worker_id="w-test",
        concurrency=2,
        max_idle_polls=2,
        poll_sec=0.05,
    )


@pytest.mark.asyncio
async def test_ingest_gmail_runner_records_count_and_succeeds(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)

    async def _fake_poll(db, *, user_id):
        assert user_id == 1
        return 3

    monkeypatch.setattr(gmail_digest, "poll_and_ingest", _fake_poll)

    async with sm() as s:
        jid = await enqueue_ingest_gmail(s)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (
            await s.execute(select(Job).where(Job.id == jid))
        ).scalar_one()
        assert job.status == "succeeded"
        assert (job.result or {}).get("created") == 3

        events = (
            await s.execute(
                select(JobEvent)
                .where(JobEvent.job_id == jid)
                .order_by(JobEvent.id)
            )
        ).scalars().all()
        phases = [e.phase for e in events]
        assert "progress" in phases
        assert "done" in phases


@pytest.mark.asyncio
async def test_ingest_gmail_runner_marks_failed_on_error(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)

    async def _boom(db, *, user_id):
        raise RuntimeError("imap exploded")

    monkeypatch.setattr(gmail_digest, "poll_and_ingest", _boom)

    async with sm() as s:
        jid = await enqueue_ingest_gmail(s)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (
            await s.execute(select(Job).where(Job.id == jid))
        ).scalar_one()
        assert job.status == "failed"
        assert "imap exploded" in (job.result or {}).get("error", "")
