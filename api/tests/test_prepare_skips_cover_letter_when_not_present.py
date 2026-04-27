"""Task 8: ``run_prepare_application_job`` honors the CL requirement resolver.

These are unit-ish tests built on the existing prepare integration fixture.
They patch :func:`app.services.jobs_runner.resolve_cover_letter_requirement`
so we exercise the new conditional branch without making real HTTP calls.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Application, Job, JobEvent
from app.services import cover_letter, jobs_runner, verify as verify_mod
from app.services.jobs_repo import enqueue_prepare_application
from app.services.sources.protocol import CoverLetterRequirement
from app.services.tailor_for_application import TailorForAppResult

# Reuse the seeders from the existing prepare runner tests.
from tests.test_prepare_application_runner import (  # noqa: E402
    _drain,
    _ensure_user,
    _seed_company,
    _seed_master_resume,
    _seed_posting,
    _seed_profile,
)


def _patch_primitives_with_cover_tracker(monkeypatch, *, cover_calls: list):
    async def fake_tailor(db, *, user_id, posting_id, on_progress=None):
        from app.models import Resume

        master = (
            await db.execute(
                select(Resume).where(
                    Resume.user_id == user_id, Resume.kind == "master"
                )
            )
        ).scalar_one()
        variant = Resume(
            user_id=user_id,
            parent_id=master.id,
            kind="variant",
            name=f"Variant {posting_id}",
            template_id=master.template_id,
            latex_source="\\documentclass{article}\\begin{document}v\\end{document}",
            protected_terms=[],
        )
        db.add(variant)
        await db.flush()
        await db.commit()
        return TailorForAppResult(
            variant_id=variant.id,
            page_count=1,
            iterations=1,
            enforced=True,
            kb_chunks_used=4,
        )

    monkeypatch.setattr(jobs_runner, "tailor_for_application", fake_tailor)

    async def fake_cover(db, *, user_id, posting_id):
        cover_calls.append(posting_id)
        return "Cover letter text body."

    monkeypatch.setattr(jobs_runner, "generate_cover_letter", fake_cover)
    monkeypatch.setattr(cover_letter, "generate_cover_letter", fake_cover)

    async def fake_verify(db, *, application_id):
        return {"ok": True, "issues": [], "rationale": "ok"}

    monkeypatch.setattr(verify_mod, "verify_application", fake_verify)


@pytest.mark.asyncio
async def test_prepare_skips_cover_letter_when_not_present(
    monkeypatch, sessionmaker_factory
):
    """Resolver returns NOT_PRESENT -> generate is not called, skip event fires."""
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    cover_calls: list = []
    _patch_primitives_with_cover_tracker(monkeypatch, cover_calls=cover_calls)

    async def fake_resolve(db, posting):
        return CoverLetterRequirement.NOT_PRESENT

    monkeypatch.setattr(
        jobs_runner, "resolve_cover_letter_requirement", fake_resolve
    )

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded", job.result

        app = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalar_one()
        assert app.cover_letter_text == ""

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        phases = [e.phase for e in events]
        assert "cover_letter_skipped" in phases
        assert "cover_letter_generated" not in phases

        skipped = next(e for e in events if e.phase == "cover_letter_skipped")
        assert skipped.data["requirement"] == "not_present"

    assert cover_calls == [], "generate_cover_letter must not be called"


@pytest.mark.asyncio
async def test_prepare_generates_cover_letter_when_required(
    monkeypatch, sessionmaker_factory
):
    """Resolver returns REQUIRED -> generate is called, generated event fires."""
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    cover_calls: list = []
    _patch_primitives_with_cover_tracker(monkeypatch, cover_calls=cover_calls)

    async def fake_resolve(db, posting):
        return CoverLetterRequirement.REQUIRED

    monkeypatch.setattr(
        jobs_runner, "resolve_cover_letter_requirement", fake_resolve
    )

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded", job.result

        app = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalar_one()
        assert app.cover_letter_text == "Cover letter text body."

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        phases = [e.phase for e in events]
        assert "cover_letter_generated" in phases
        assert "cover_letter_skipped" not in phases

        gen = next(e for e in events if e.phase == "cover_letter_generated")
        assert gen.data["requirement"] == "required"
        assert gen.data["length"] == len("Cover letter text body.")

    assert cover_calls == [posting_id]
