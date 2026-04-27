"""Tests for the background worker supervisor loop and scheduler."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select, update

from app.models import (
    Application,
    Company,
    Job,
    JobPosting,
    Resume,
    Tier,
    User,
)
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
    monkeypatch.setitem(jobs_runner.RUNNERS, "tailor", fake_run)

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


@pytest.mark.asyncio
async def test_worker_dispatches_via_runners_table(
    monkeypatch, sessionmaker_factory
):
    """The worker should look up the runner via ``jobs_runner.RUNNERS``.

    Registering a fake kind in the dispatch table is the only thing required
    to teach the worker about new job kinds — no edit to ``_dispatch`` itself.
    """
    from app.services import jobs_runner

    calls: list = []

    async def fake_runner(sf, jid):
        calls.append(jid)
        async with sf() as s:
            await s.execute(
                update(Job).where(Job.id == jid).values(status="succeeded")
            )
            await s.commit()

    monkeypatch.setitem(jobs_runner.RUNNERS, "fake_kind", fake_runner)

    async with sessionmaker_factory() as s:
        job = Job(kind="fake_kind", status="queued", payload={})
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

    assert calls == [jid]
    async with sessionmaker_factory() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"


# --- Scheduler --------------------------------------------------------------


@pytest.mark.asyncio
async def test_scheduler_loops_and_shuts_down_cleanly(
    monkeypatch, sessionmaker_factory
):
    """Drive ``_scheduler`` with a short interval; assert it ticks at least
    twice and exits cleanly when the shutdown event is set."""
    from app import worker

    monkeypatch.setattr(worker, "INGEST_INTERVAL_SEC", 0.05)

    tick_count = {"n": 0}

    async def fake_enqueue(_sf):
        tick_count["n"] += 1

    monkeypatch.setattr(worker, "_enqueue_due_ingests", fake_enqueue)

    shutdown = asyncio.Event()
    task = asyncio.create_task(worker._scheduler(sessionmaker_factory, shutdown))

    await asyncio.sleep(0.15)
    shutdown.set()
    await asyncio.wait_for(task, timeout=1.0)

    assert tick_count["n"] >= 2


@pytest.mark.asyncio
async def test_scheduler_enqueues_ingest_per_enabled_company(
    sessionmaker_factory,
):
    from app.worker import _enqueue_due_ingests

    async with sessionmaker_factory() as s:
        s.add(Company(slug="a", display_name="A", source="greenhouse", enabled=True))
        s.add(Company(slug="b", display_name="B", source="greenhouse", enabled=True))
        s.add(Company(slug="c", display_name="C", source="greenhouse", enabled=False))
        await s.commit()

    await _enqueue_due_ingests(sessionmaker_factory)

    async with sessionmaker_factory() as s:
        jobs = (
            await s.execute(
                select(Job).where(Job.kind == "ingest_greenhouse")
            )
        ).scalars().all()
        slugs = sorted((j.payload or {}).get("company_slug") for j in jobs)
        assert slugs == ["a", "b"]
        assert all(j.status == "queued" for j in jobs)


async def _seed_amode_app(
    sm,
    *,
    source_job_id: str,
    tier: str = "targeted",
    company_id: int,
    variant_id: int,
) -> int:
    async with sm() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id=source_job_id,
            company_id=company_id,
            title="Backend",
            location="Remote",
            apply_url=f"https://example.test/jobs/{source_job_id}",
            description_text="x",
            meta={},
            tier=tier,
            fit_score=70,
            status="ready",
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        a = Application(
            user_id=1,
            posting_id=p.id,
            mode="A",
            status="prepared",
            resume_variant_id=variant_id,
            cover_letter_text="x",
            form_payload={},
            canonical_key=f"acme|jobs/{source_job_id}",
            verify_ok=True,
        )
        s.add(a)
        await s.commit()
        await s.refresh(a)
        return a.id


@pytest.mark.asyncio
async def test_scheduler_enqueues_amode_submits_within_cap(
    sessionmaker_factory,
):
    """3 prepared A-mode applications under a tier with daily_cap=2 must
    yield exactly 2 enqueued submit_application jobs on a single tick."""
    from app.worker import _enqueue_due_amode_submits

    sm = sessionmaker_factory
    async with sm() as s:
        s.add(User(id=1))
        s.add(
            Tier(
                slug="targeted",
                display_name="Targeted",
                min_fit_score=65,
                daily_cap=2,
                default_mode="A",
                tailor_model="sonnet-4.6",
                classify_model="haiku-4.5",
                enabled=True,
            )
        )
        c = Company(slug="acme", display_name="Acme", source="greenhouse")
        s.add(c)
        r = Resume(
            user_id=1,
            kind="variant",
            name="V",
            template_id="jakes",
            latex_source="x",
            protected_terms=[],
        )
        s.add(r)
        await s.commit()
        company_id = c.id
        variant_id = r.id

    a1 = await _seed_amode_app(
        sm, source_job_id="1", company_id=company_id, variant_id=variant_id
    )
    a2 = await _seed_amode_app(
        sm, source_job_id="2", company_id=company_id, variant_id=variant_id
    )
    a3 = await _seed_amode_app(
        sm, source_job_id="3", company_id=company_id, variant_id=variant_id
    )

    await _enqueue_due_amode_submits(sm)

    async with sm() as s:
        jobs = (
            await s.execute(
                select(Job).where(Job.kind == "submit_application")
            )
        ).scalars().all()
        app_ids = sorted(
            (j.payload or {}).get("application_id") for j in jobs
        )
        # cap=2 → exactly 2 of {a1, a2, a3} enqueued.
        assert len(jobs) == 2
        assert set(app_ids).issubset({a1, a2, a3})


@pytest.mark.asyncio
async def test_scheduler_amode_skips_apps_with_inflight_submit(
    sessionmaker_factory,
):
    from app.worker import _enqueue_due_amode_submits

    sm = sessionmaker_factory
    async with sm() as s:
        s.add(User(id=1))
        s.add(
            Tier(
                slug="targeted",
                display_name="Targeted",
                min_fit_score=65,
                daily_cap=10,
                default_mode="A",
                tailor_model="sonnet-4.6",
                classify_model="haiku-4.5",
                enabled=True,
            )
        )
        c = Company(slug="acme", display_name="Acme", source="greenhouse")
        s.add(c)
        r = Resume(
            user_id=1,
            kind="variant",
            name="V",
            template_id="jakes",
            latex_source="x",
            protected_terms=[],
        )
        s.add(r)
        await s.commit()
        company_id = c.id
        variant_id = r.id

    a1 = await _seed_amode_app(
        sm, source_job_id="1", company_id=company_id, variant_id=variant_id
    )

    # Pre-existing queued submit job for a1 — scheduler must skip.
    async with sm() as s:
        s.add(
            Job(
                kind="submit_application",
                status="queued",
                payload={"application_id": a1},
            )
        )
        await s.commit()

    await _enqueue_due_amode_submits(sm)

    async with sm() as s:
        jobs = (
            await s.execute(
                select(Job).where(Job.kind == "submit_application")
            )
        ).scalars().all()
        # Exactly the one pre-existing job remains; scheduler did not
        # double-enqueue.
        assert len(jobs) == 1


@pytest.mark.asyncio
async def test_scheduler_amode_kill_switch_skips_branch(
    monkeypatch, sessionmaker_factory
):
    from app.worker import _enqueue_due_amode_submits

    sm = sessionmaker_factory
    async with sm() as s:
        s.add(User(id=1))
        s.add(
            Tier(
                slug="targeted",
                display_name="Targeted",
                min_fit_score=65,
                daily_cap=10,
                default_mode="A",
                tailor_model="sonnet-4.6",
                classify_model="haiku-4.5",
                enabled=True,
            )
        )
        c = Company(slug="acme", display_name="Acme", source="greenhouse")
        s.add(c)
        r = Resume(
            user_id=1,
            kind="variant",
            name="V",
            template_id="jakes",
            latex_source="x",
            protected_terms=[],
        )
        s.add(r)
        await s.commit()
        company_id = c.id
        variant_id = r.id

    await _seed_amode_app(
        sm, source_job_id="1", company_id=company_id, variant_id=variant_id
    )

    monkeypatch.setenv("AUTONOMOUS_SUBMIT_DISABLED", "1")
    await _enqueue_due_amode_submits(sm)

    async with sm() as s:
        jobs = (
            await s.execute(
                select(Job).where(Job.kind == "submit_application")
            )
        ).scalars().all()
        assert jobs == []


@pytest.mark.asyncio
async def test_scheduler_skips_companies_with_in_flight_ingest(
    sessionmaker_factory,
):
    from app.worker import _enqueue_due_ingests

    async with sessionmaker_factory() as s:
        s.add(Company(slug="a", display_name="A", source="greenhouse", enabled=True))
        s.add(Company(slug="b", display_name="B", source="greenhouse", enabled=True))
        # Pre-existing queued ingest for "a" — scheduler must skip it.
        s.add(
            Job(
                kind="ingest_greenhouse",
                status="queued",
                payload={"company_slug": "a"},
            )
        )
        await s.commit()

    await _enqueue_due_ingests(sessionmaker_factory)

    async with sessionmaker_factory() as s:
        jobs = (
            await s.execute(
                select(Job).where(Job.kind == "ingest_greenhouse")
            )
        ).scalars().all()
        slugs_per_job = [(j.payload or {}).get("company_slug") for j in jobs]
        assert sorted(slugs_per_job) == ["a", "b"]
        # Exactly one job per slug — the pre-existing one for "a" was reused.
        assert slugs_per_job.count("a") == 1
        assert slugs_per_job.count("b") == 1
