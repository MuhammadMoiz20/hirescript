"""Tests for the background worker supervisor loop and scheduler."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select, update

from app.models import Company, Job
from app.services.sources.greenhouse_companies import GREENHOUSE_COMPANIES


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
async def test_scheduler_seeds_companies_on_first_boot(sessionmaker_factory):
    from app.worker import _seed_companies

    await _seed_companies(sessionmaker_factory)
    async with sessionmaker_factory() as s:
        rows = (await s.execute(select(Company))).scalars().all()
        slugs = {r.slug for r in rows}
        assert slugs == {slug for slug, _ in GREENHOUSE_COMPANIES}
        assert len(rows) == len(GREENHOUSE_COMPANIES)

    # Re-running is idempotent: row count unchanged, no duplicate-slug failure.
    await _seed_companies(sessionmaker_factory)
    async with sessionmaker_factory() as s:
        rows = (await s.execute(select(Company))).scalars().all()
        assert len(rows) == len(GREENHOUSE_COMPANIES)


@pytest.mark.asyncio
async def test_seed_companies_adds_only_missing_slugs(sessionmaker_factory):
    """Pre-seed a subset of allowlist slugs; reconcile must add the rest
    while leaving pre-existing rows untouched (e.g. an operator-edited
    display_name must not be overwritten)."""
    from app.worker import _seed_companies

    pre_seeded = list(GREENHOUSE_COMPANIES)[:2]
    custom_display = "Operator Edited Display"

    async with sessionmaker_factory() as s:
        for slug, _display in pre_seeded:
            s.add(
                Company(
                    slug=slug,
                    display_name=custom_display,
                    source="greenhouse",
                    enabled=True,
                )
            )
        await s.commit()

    await _seed_companies(sessionmaker_factory)

    async with sessionmaker_factory() as s:
        rows = (await s.execute(select(Company))).scalars().all()
        slugs = {r.slug for r in rows}
        assert slugs == {slug for slug, _ in GREENHOUSE_COMPANIES}
        assert len(rows) == len(GREENHOUSE_COMPANIES)
        # Pre-seeded rows preserved verbatim — display_name not overwritten.
        by_slug = {r.slug: r for r in rows}
        for slug, _display in pre_seeded:
            assert by_slug[slug].display_name == custom_display


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
