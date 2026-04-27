"""Behavioral tests for ``run_prepare_application_job``."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import (
    Application,
    AnswerCache,
    Company,
    Job,
    JobEvent,
    JobPosting,
    Profile as ProfileModel,
    Resume,
    User,
)
from app.services import answer_cache, cover_letter, jobs_runner, verify as verify_mod
from app.services.jobs_repo import enqueue_prepare_application
from app.services.tailor_for_application import TailorForAppResult


async def _ensure_user(sm) -> None:
    async with sm() as s:
        existing = (
            await s.execute(select(User).where(User.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            s.add(User(id=1))
            await s.commit()


async def _seed_profile(sm, **overrides) -> None:
    data = {
        "legal_name": "Moiz Zahid",
        "email": "moiz@example.com",
        "phone": "+15555550100",
        "links": {
            "linkedin": "https://linkedin.com/in/moiz",
            "github": "https://github.com/moiz",
            "site": "https://moiz.dev",
        },
        "preferences": {"role_families": ["backend"]},
    }
    data.update(overrides)
    async with sm() as s:
        s.add(ProfileModel(user_id=1, data=data))
        await s.commit()


async def _seed_master_resume(sm) -> int:
    async with sm() as s:
        r = Resume(
            user_id=1,
            kind="master",
            parent_id=None,
            name="Master",
            template_id="jakes",
            latex_source="\\documentclass{article}\\begin{document}m\\end{document}",
            protected_terms=[],
        )
        s.add(r)
        await s.commit()
        await s.refresh(r)
        return r.id


async def _seed_company(sm, slug: str = "anthropic") -> int:
    async with sm() as s:
        c = Company(slug=slug, display_name="Anthropic", source="greenhouse")
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.id


async def _seed_posting(
    sm, *, company_id: int | None = None, source_job_id: str = "1",
    apply_url: str = "https://boards.greenhouse.io/anthropic/jobs/1",
) -> int:
    async with sm() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id=source_job_id,
            company_id=company_id,
            title="Backend Engineer",
            location="Remote",
            apply_url=apply_url,
            description_text="We do distributed systems.",
            meta={},
            status="classified",
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        return p.id


async def _drain(sm):
    from app.worker import run_until_idle

    await run_until_idle(
        sm,
        worker_id="w-test",
        concurrency=2,
        max_idle_polls=2,
        poll_sec=0.05,
    )


def _patch_primitives(monkeypatch, *, variant_id_holder=None):
    async def fake_tailor(db, *, user_id, posting_id, on_progress=None):
        # Persist a real variant Resume so resume_variant_id FK is valid.
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
        if variant_id_holder is not None:
            variant_id_holder["id"] = variant.id
        return TailorForAppResult(
            variant_id=variant.id,
            page_count=1,
            iterations=1,
            enforced=True,
            kb_chunks_used=4,
        )

    monkeypatch.setattr(jobs_runner, "tailor_for_application", fake_tailor)

    async def fake_cover(db, *, user_id, posting_id):
        return "Cover letter text body."

    monkeypatch.setattr(jobs_runner, "generate_cover_letter", fake_cover)
    # also patch the cover_letter module (defensive against direct imports)
    monkeypatch.setattr(cover_letter, "generate_cover_letter", fake_cover)

    async def fake_verify(db, *, application_id):
        return {"ok": True, "issues": [], "rationale": "all grounded"}

    monkeypatch.setattr(verify_mod, "verify_application", fake_verify)


@pytest.mark.asyncio
async def test_prepare_application_happy_path(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    _patch_primitives(monkeypatch)

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded", job.result
        assert job.result["posting_id"] == posting_id
        assert job.result["application_id"] is not None
        assert job.result["page_count"] == 1
        assert job.result["kb_chunks_used"] == 4

        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        assert posting.status == "ready"
        assert posting.canonical_key
        assert "anthropic" in posting.canonical_key

        apps = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalars().all()
        assert len(apps) == 1
        app = apps[0]
        assert app.status == "prepared"
        assert app.mode == "B"
        assert app.cover_letter_text == "Cover letter text body."
        assert app.form_payload["first_name"] == "Moiz"
        assert app.form_payload["last_name"] == "Zahid"
        assert app.form_payload["email"] == "moiz@example.com"
        assert app.form_payload["linkedin"].endswith("moiz")
        assert app.form_payload["github"].endswith("moiz")
        assert app.canonical_key == posting.canonical_key
        assert app.resume_variant_id is not None
        # Verify pass populated the three columns on the row.
        assert app.verify_ok is True
        assert app.verify_issues == []
        assert app.verify_rationale == "all grounded"


@pytest.mark.asyncio
async def test_prepare_application_skips_duplicate(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    _patch_primitives(monkeypatch)

    # Pre-insert an Application with the canonical_key the orchestrator
    # will compute for this posting.
    from app.services.canonical import canonicalize

    async with sm() as s:
        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        key = canonicalize("Anthropic", posting.apply_url)
        # Need a resume_variant for FK? It's nullable. Skip.
        s.add(
            Application(
                user_id=1,
                posting_id=posting_id,
                mode="B",
                status="prepared",
                cover_letter_text=None,
                form_payload={},
                canonical_key=key,
            )
        )
        await s.commit()

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["skipped"] is True

        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        assert posting.status == "duplicate_skipped"

        apps = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalars().all()
        # No new app — only the one pre-seeded.
        assert len(apps) == 1


@pytest.mark.asyncio
async def test_prepare_application_race_collision(
    monkeypatch, sessionmaker_factory
):
    """Pre-submit gate misses; unique constraint catches duplicate at flush.

    Simulates a race where the gate ``SELECT`` returns no row, but a
    competing path inserts an :class:`Application` with the same
    canonical_key before the orchestrator's flush. The
    :class:`IntegrityError` handler must rollback, mark the posting
    ``duplicate_skipped`` from a fresh session, and finish the job
    ``succeeded`` with ``skipped=True``.
    """
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    # Patch tailor with the standard fake (creates a real variant Resume).
    _patch_primitives(monkeypatch)

    from app.services.canonical import canonicalize

    # Override generate_cover_letter to ALSO insert a competing Application
    # row with the same canonical_key right before returning. This bypasses
    # the orchestrator's pre-submit gate (which already ran) and forces the
    # IntegrityError on the orchestrator's own flush.
    async def racing_cover(db, *, user_id, posting_id):
        posting = await db.get(JobPosting, posting_id)
        company_name = None
        if posting.company_id is not None:
            company_row = await db.get(Company, posting.company_id)
            if company_row is not None:
                company_name = company_row.display_name
        canon = canonicalize(company_name, posting.apply_url)
        db.add(
            Application(
                user_id=user_id,
                posting_id=posting_id,
                mode="B",
                status="prepared",
                cover_letter_text=None,
                form_payload={},
                canonical_key=canon,
            )
        )
        await db.commit()
        return "racing cover letter"

    monkeypatch.setattr(jobs_runner, "generate_cover_letter", racing_cover)
    monkeypatch.setattr(cover_letter, "generate_cover_letter", racing_cover)

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded", job.result
        assert job.result["skipped"] is True
        assert job.result["posting_id"] == posting_id

        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        # The IntegrityError handler flipped the posting from "preparing"
        # to "duplicate_skipped" via a fresh session.
        assert posting.status == "duplicate_skipped"

        apps = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalars().all()
        # Only the racing row survived — the orchestrator's insert was
        # rolled back, not committed twice.
        assert len(apps) == 1
        assert apps[0].cover_letter_text is None


@pytest.mark.asyncio
async def test_prepare_application_seeds_form_payload_from_profile(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    _patch_primitives(monkeypatch)

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        app = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalar_one()
        fp = app.form_payload
        assert fp["first_name"] == "Moiz"
        assert fp["last_name"] == "Zahid"
        assert fp["email"] == "moiz@example.com"
        assert fp["phone"] == "+15555550100"
        assert "linkedin" in fp["linkedin"]
        assert "github" in fp["github"]


@pytest.mark.asyncio
async def test_prepare_application_uses_answer_cache(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    async with sm() as s:
        await answer_cache.store(
            s,
            user_id=1,
            question="Why this company?",
            answer="Because of the mission.",
        )
        await s.commit()

    _patch_primitives(monkeypatch)

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        app = (
            await s.execute(
                select(Application).where(Application.posting_id == posting_id)
            )
        ).scalar_one()
        assert app.form_payload["why_company"] == "Because of the mission."


@pytest.mark.asyncio
async def test_prepare_application_survives_verifier_exception(
    monkeypatch, sessionmaker_factory
):
    """A verifier exception must NOT block preparation.

    The application is still created with verify_ok=None, the job ends
    succeeded, and a ``verify_skipped`` event is emitted.
    """
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    _patch_primitives(monkeypatch)

    async def boom_verify(db, *, application_id):
        raise RuntimeError("haiku exploded")

    monkeypatch.setattr(verify_mod, "verify_application", boom_verify)

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
        # Application was created, but verify_ok is None because the
        # verifier raised — submit (Batch C) will treat None as
        # "not verified, allow only B-mode".
        assert app.verify_ok is None
        assert app.verify_issues == []
        assert app.verify_rationale is None

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        assert any(e.phase == "verify_skipped" for e in events)


@pytest.mark.asyncio
async def test_prepare_application_failure_marks_posting_errored(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_profile(sm)
    await _seed_master_resume(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)

    async def boom(db, *, user_id, posting_id, on_progress=None):
        raise RuntimeError("tailor exploded")

    monkeypatch.setattr(jobs_runner, "tailor_for_application", boom)

    async with sm() as s:
        jid = await enqueue_prepare_application(s, posting_id=posting_id)
        await s.commit()
    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        assert "tailor exploded" in (job.result or {}).get("error", "")

        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        assert posting.status == "errored"

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        assert any(e.phase == "failed" for e in events)
