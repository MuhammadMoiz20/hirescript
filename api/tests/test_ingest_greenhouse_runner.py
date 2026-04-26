"""Behavioral tests for ``run_ingest_greenhouse_job``.

We monkeypatch ``fetch_company_jobs`` at the call site (the runner module's
namespace) so no network traffic occurs. The worker is driven via
``run_until_idle`` against the in-memory sqlite fixture so the dispatch
table is exercised end-to-end.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.models import Company, Job, JobEvent, JobPosting, User
from app.services import jobs_runner
from app.services.jobs_repo import enqueue_ingest_greenhouse
from app.services.sources.greenhouse import NormalizedPosting


def _make_posting(source_job_id: str, *, title: str = "Engineer") -> NormalizedPosting:
    return NormalizedPosting(
        source_job_id=source_job_id,
        title=title,
        location="Remote",
        apply_url=f"https://boards.greenhouse.io/anthropic/jobs/{source_job_id}",
        description_html="<p>desc</p>",
        description_text="desc",
        meta={"greenhouse_id": int(source_job_id)},
    )


async def _ensure_user(sm) -> None:
    async with sm() as s:
        existing = (
            await s.execute(select(User).where(User.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            s.add(User(id=1))
            await s.commit()


async def _seed_company(sm, slug: str = "anthropic") -> int:
    async with sm() as s:
        company = Company(
            slug=slug, display_name=slug.title(), source="greenhouse"
        )
        s.add(company)
        await s.commit()
        await s.refresh(company)
        return company.id


async def _enqueue(sm, slug: str):
    async with sm() as s:
        jid = await enqueue_ingest_greenhouse(s, company_slug=slug)
        await s.commit()
        return jid


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
async def test_ingest_greenhouse_runner_upserts_postings(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_company(sm, "anthropic")

    async def fake_fetch(slug, *, http):
        assert slug == "anthropic"
        return [_make_posting("1"), _make_posting("2", title="Researcher")]

    monkeypatch.setattr(jobs_runner, "fetch_company_jobs", fake_fetch)

    jid = await _enqueue(sm, "anthropic")
    await _drain(sm)

    async with sm() as s:
        rows = (await s.execute(select(JobPosting))).scalars().all()
        assert len(rows) == 2
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["created"] == 2
        assert job.result["updated"] == 0
        assert job.result["unchanged"] == 0
        assert job.result["slug"] == "anthropic"


@pytest.mark.asyncio
async def test_ingest_greenhouse_runner_emits_events(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_company(sm, "anthropic")

    async def fake_fetch(slug, *, http):
        return [_make_posting("1")]

    monkeypatch.setattr(jobs_runner, "fetch_company_jobs", fake_fetch)

    jid = await _enqueue(sm, "anthropic")
    await _drain(sm)

    async with sm() as s:
        events = (
            await s.execute(
                select(JobEvent)
                .where(JobEvent.job_id == jid)
                .order_by(JobEvent.id)
            )
        ).scalars().all()
        phases = [e.phase for e in events]
        # In order: ingest_start, ingest_fetched, ingest_upserted, done.
        for required in ("ingest_start", "ingest_fetched", "ingest_upserted", "done"):
            assert required in phases, phases
        assert phases.index("ingest_start") < phases.index("ingest_fetched")
        assert phases.index("ingest_fetched") < phases.index("ingest_upserted")
        assert phases.index("ingest_upserted") < phases.index("done")


@pytest.mark.asyncio
async def test_ingest_greenhouse_runner_handles_404(
    monkeypatch, sessionmaker_factory
):
    """A 404 is normalized to ``[]`` by the fetcher; the run still succeeds."""
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_company(sm, "ghost")

    async def fake_fetch(slug, *, http):
        return []

    monkeypatch.setattr(jobs_runner, "fetch_company_jobs", fake_fetch)

    jid = await _enqueue(sm, "ghost")
    await _drain(sm)

    async with sm() as s:
        rows = (await s.execute(select(JobPosting))).scalars().all()
        assert rows == []
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["created"] == 0
        assert job.result["updated"] == 0
        assert job.result["unchanged"] == 0


@pytest.mark.asyncio
async def test_ingest_greenhouse_runner_fails_on_network_error(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_company(sm, "anthropic")

    async def fake_fetch(slug, *, http):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(jobs_runner, "fetch_company_jobs", fake_fetch)

    jid = await _enqueue(sm, "anthropic")
    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        assert "boom" in (job.result or {}).get("error", "")
        events = (
            await s.execute(
                select(JobEvent).where(JobEvent.job_id == jid)
            )
        ).scalars().all()
        assert any(e.phase == "failed" for e in events)
