"""Tests for the tailor job runner.

The runner is exercised end-to-end against the in-memory aiosqlite engine from
conftest. ``tailor_resume`` is monkeypatched so we don't depend on the live
agent / Tectonic compile path. ``snapshot_resume_version`` writes a
``ResumeVersion`` row and *attempts* to push the PDF bytes to S3/MinIO; the
versioning service swallows storage failures with a warning, so we let that
warning fire rather than mocking S3 here.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select, update

from app.models import Job, JobDescription, JobEvent, Resume, User


def _make_tailor_result(**overrides):
    from app.services.tailor import TailorResult

    defaults = dict(
        variant_latex="\\documentclass{article}\\begin{document}x\\end{document}",
        pdf=b"%PDF-fake",
        page_count=1,
        enforced=True,
        iterations=1,
        tier_history=["sonnet"],
        keywords_used=["python"],
    )
    defaults.update(overrides)
    return TailorResult(**defaults)


@pytest.mark.asyncio
async def test_runs_tailor_and_succeeds(
    monkeypatch, sessionmaker_factory, seeded_master_resume
):
    from app.services import jobs_runner
    from app.services.jobs_runner import run_tailor_job

    async def fake_tailor(
        *,
        master_latex,
        jd_text,
        user_pinned=None,
        deep_tailor=False,
        on_progress=None,
        **kwargs,
    ):
        assert on_progress is not None
        await on_progress("draft_start", {"tier": "sonnet"})
        return _make_tailor_result()

    monkeypatch.setattr(jobs_runner, "tailor_resume", fake_tailor)

    async with sessionmaker_factory() as s:
        job = Job(
            kind="tailor",
            status="running",
            worker_id="w-1",
            payload={
                "resume_id": seeded_master_resume.id,
                "jd_text": "JD here",
                "title": "SWE",
                "company": "Acme",
                "url": None,
                "deep": False,
            },
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        jid = job.id

    await run_tailor_job(sessionmaker_factory, jid)

    async with sessionmaker_factory() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.finished_at is not None
        assert job.result["page_count"] == 1
        assert job.result["enforced"] is True
        assert job.result["iterations"] == 1
        assert job.result["tier_history"] == ["sonnet"]
        assert job.result["keywords_used"] == ["python"]
        assert "variant_id" in job.result
        assert "jd_id" in job.result

        # Variant + JD persisted with expected wiring.
        variant = (
            await s.execute(select(Resume).where(Resume.id == job.result["variant_id"]))
        ).scalar_one()
        assert variant.kind == "variant"
        assert variant.parent_id == seeded_master_resume.id
        assert variant.user_id == 1
        assert variant.template_id == seeded_master_resume.template_id
        assert variant.job_description_id == job.result["jd_id"]
        assert "Acme" in variant.name

        jd = (
            await s.execute(
                select(JobDescription).where(JobDescription.id == job.result["jd_id"])
            )
        ).scalar_one()
        assert jd.title == "SWE"
        assert jd.company == "Acme"
        assert jd.parsed_json == {"keywords": ["python"]}

        evs = (
            await s.execute(
                select(JobEvent).where(JobEvent.job_id == jid).order_by(JobEvent.id)
            )
        ).scalars().all()
        phases = [e.phase for e in evs]
        assert "draft_start" in phases
        assert phases[-1] == "done"


@pytest.mark.asyncio
async def test_cancellation_between_progress_events(
    monkeypatch, sessionmaker_factory, seeded_master_resume
):
    from app.services import jobs_runner
    from app.services.jobs_runner import run_tailor_job

    job_id_holder: dict = {}

    async def fake_tailor(
        *,
        master_latex,
        jd_text,
        user_pinned=None,
        deep_tailor=False,
        on_progress=None,
        **kwargs,
    ):
        assert on_progress is not None
        # First progress event — runner persists JobEvent + checks status.
        await on_progress("draft_start", {})
        # External actor flips the job to cancelled before the next checkpoint.
        # Mirrors what jobs_repo.cancel_job does (status + finished_at).
        from datetime import datetime, timezone
        async with sessionmaker_factory() as s:
            await s.execute(
                update(Job)
                .where(Job.id == job_id_holder["jid"])
                .values(status="cancelled", finished_at=datetime.now(timezone.utc))
            )
            await s.commit()
        # Second progress event — _is_cancelled now returns True, raises.
        await on_progress("repair_attempt", {"iteration": 1})
        # Should not reach here.
        return _make_tailor_result()

    monkeypatch.setattr(jobs_runner, "tailor_resume", fake_tailor)

    async with sessionmaker_factory() as s:
        job = Job(
            kind="tailor",
            status="running",
            worker_id="w-1",
            payload={
                "resume_id": seeded_master_resume.id,
                "jd_text": "JD",
                "title": "SWE",
                "company": "Acme",
                "url": None,
                "deep": False,
            },
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        job_id_holder["jid"] = job.id
        jid = job.id

    await run_tailor_job(sessionmaker_factory, jid)

    async with sessionmaker_factory() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "cancelled"
        assert job.finished_at is not None
        # No variant / jd should have been created.
        variants = (
            await s.execute(select(Resume).where(Resume.kind == "variant"))
        ).scalars().all()
        assert variants == []

        evs = (
            await s.execute(
                select(JobEvent).where(JobEvent.job_id == jid).order_by(JobEvent.id)
            )
        ).scalars().all()
        phases = [e.phase for e in evs]
        assert "draft_start" in phases
        assert "cancelled" in phases
        assert "done" not in phases


@pytest.mark.asyncio
async def test_tailor_failure_marks_job_failed(
    monkeypatch, sessionmaker_factory, seeded_master_resume
):
    from app.services import jobs_runner
    from app.services.jobs_runner import run_tailor_job

    async def fake_tailor(
        *,
        master_latex,
        jd_text,
        user_pinned=None,
        deep_tailor=False,
        on_progress=None,
        **kwargs,
    ):
        raise ValueError("boom")

    monkeypatch.setattr(jobs_runner, "tailor_resume", fake_tailor)

    async with sessionmaker_factory() as s:
        job = Job(
            kind="tailor",
            status="running",
            worker_id="w-1",
            payload={
                "resume_id": seeded_master_resume.id,
                "jd_text": "JD",
                "title": "SWE",
                "company": "Acme",
                "url": None,
                "deep": False,
            },
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        jid = job.id

    await run_tailor_job(sessionmaker_factory, jid)

    async with sessionmaker_factory() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        assert job.finished_at is not None
        assert "boom" in job.result["error"]

        evs = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        phases = [e.phase for e in evs]
        assert "failed" in phases
        failed_event = next(e for e in evs if e.phase == "failed")
        assert failed_event.message and "boom" in failed_event.message
