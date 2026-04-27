"""Behavioral tests for ``run_classify_posting_job`` + the ingest runner's
post-ingest enqueue of classify jobs."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import (
    Company,
    Job,
    JobEvent,
    JobPosting,
    Profile as ProfileModel,
    User,
)
from app.services import classify, jobs_runner
from app.services.jobs_repo import (
    enqueue_classify_posting,
    enqueue_ingest_greenhouse,
)
from app.services.sources.greenhouse import NormalizedPosting


def _make_posting(source_job_id: str, *, title: str = "Engineer") -> NormalizedPosting:
    return NormalizedPosting(
        source_job_id=source_job_id,
        title=title,
        location="Remote",
        apply_url=f"https://example.test/jobs/{source_job_id}",
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


async def _seed_profile(sm) -> None:
    async with sm() as s:
        s.add(
            ProfileModel(
                user_id=1,
                data={
                    "legal_name": "Moiz",
                    "preferences": {
                        "role_families": ["backend"],
                        "dealbreakers": [],
                    },
                },
            )
        )
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


async def _seed_posting(sm) -> int:
    async with sm() as s:
        posting = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id="11",
            title="Backend Engineer",
            location="Remote",
            apply_url="https://example.test/apply/11",
            description_text="We build distributed systems.",
            meta={},
            status="new",
        )
        s.add(posting)
        await s.commit()
        await s.refresh(posting)
        return posting.id


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
async def test_classify_runner_happy_path(monkeypatch, sessionmaker_factory):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    posting_id = await _seed_posting(sm)

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        return {"tier": "dream", "fit_score": 92, "rationale": "Great match."}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    async with sm() as s:
        jid = await enqueue_classify_posting(s, posting_id=posting_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["tier"] == "dream"
        assert job.result["fit_score"] == 92

        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        assert posting.tier == "dream"
        assert posting.fit_score == 92
        assert posting.status == "classified"

        events = (
            await s.execute(
                select(JobEvent).where(JobEvent.job_id == jid).order_by(JobEvent.id)
            )
        ).scalars().all()
        phases = [e.phase for e in events]
        for required in ("classify_start", "classify_done", "done"):
            assert required in phases, phases


@pytest.mark.asyncio
async def test_classify_runner_marks_failed_on_invalid_json(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    posting_id = await _seed_posting(sm)

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        return {"tier": "bogus", "fit_score": 50, "rationale": "x"}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    async with sm() as s:
        jid = await enqueue_classify_posting(s, posting_id=posting_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        assert any(e.phase == "failed" for e in events)


@pytest.mark.asyncio
async def test_ingest_runner_enqueues_classify_per_new_posting(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_company(sm, "anthropic")

    async def fake_fetch(slug, *, http):
        return [_make_posting("1"), _make_posting("2", title="Researcher")]

    # Slice 4 Batch A: the runner now resolves the adapter via SOURCES,
    # so we patch the adapter method instead of the legacy module-level fn.
    from app.services.sources import SOURCES

    monkeypatch.setattr(
        SOURCES["greenhouse"], "fetch_company_postings", fake_fetch
    )

    # Stub out the Haiku call so the spawned classify jobs succeed without
    # network. We don't care about the result here, only the enqueue count.
    async def fake_query_json(*, system_prompt, user_prompt, tier):
        return {"tier": "wide_net", "fit_score": 50, "rationale": "ok"}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    async with sm() as s:
        jid = await enqueue_ingest_greenhouse(s, company_slug="anthropic")
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        classify_jobs = (
            await s.execute(
                select(Job).where(Job.kind == "classify_posting")
            )
        ).scalars().all()
        assert len(classify_jobs) == 2
        assert all(j.status == "succeeded" for j in classify_jobs), [
            (j.status, j.result) for j in classify_jobs
        ]

    # Re-running the same fetch should NOT enqueue more classify jobs (no
    # newly-created postings). Bump status to make the rerun unambiguous.
    async with sm() as s:
        jid2 = await enqueue_ingest_greenhouse(s, company_slug="anthropic")
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        classify_jobs = (
            await s.execute(
                select(Job).where(Job.kind == "classify_posting")
            )
        ).scalars().all()
        assert len(classify_jobs) == 2  # unchanged
