"""Behavioral tests for ``run_submit_application_job``.

The Greenhouse Playwright adapter is monkeypatched — Task 14's tests cover
the real browser drive. Here we assert the runner's state transitions,
dedup gate, artifact persistence, and error handling.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models import (
    Application,
    Company,
    Job,
    JobEvent,
    JobPosting,
    Resume,
    ResumeVersion,
    User,
)
from app.services import jobs_runner
from app.services.jobs_repo import enqueue_submit_application
from app.services.submit_adapters import greenhouse as greenhouse_submit


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
        c = Company(slug=slug, display_name="Anthropic", source="greenhouse")
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.id


async def _seed_posting(sm, *, company_id: int) -> int:
    async with sm() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id="42",
            company_id=company_id,
            title="Backend Engineer",
            location="Remote",
            apply_url="https://boards.greenhouse.io/anthropic/jobs/42",
            description_text="We do distributed systems.",
            meta={},
            status="ready",
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        return p.id


async def _seed_variant_resume_with_version(sm, tmp_path) -> int:
    """Insert a variant Resume + a ResumeVersion + write a local PDF.

    The runner falls back to ``/app/compiled_pdfs/versions/<id>.pdf`` when
    MinIO is unreachable — but in tests we monkeypatch the resolver, so the
    on-disk fixture is just defensive belt-and-braces.
    """
    async with sm() as s:
        r = Resume(
            user_id=1,
            kind="variant",
            parent_id=None,
            name="Variant",
            template_id="jakes",
            latex_source="\\documentclass{article}\\begin{document}v\\end{document}",
            protected_terms=[],
        )
        s.add(r)
        await s.commit()
        await s.refresh(r)

        v = ResumeVersion(
            resume_id=r.id,
            latex_source=r.latex_source,
            content_json={},
            page_count=1,
            edit_source="ai_tailor",
            edit_prompt=None,
            compiled_pdf_key=f"versions/{r.id}.pdf",
        )
        s.add(v)
        await s.commit()
        return r.id


async def _seed_application(
    sm, *, posting_id: int, variant_id: int, canonical_key: str,
    status: str = "prepared",
) -> int:
    async with sm() as s:
        app = Application(
            user_id=1,
            posting_id=posting_id,
            mode="B",
            status=status,
            resume_variant_id=variant_id,
            cover_letter_text="Cover letter body.",
            form_payload={
                "first_name": "Moiz",
                "last_name": "Zahid",
                "email": "moiz@example.com",
                "phone": "+15555550100",
                "linkedin": "https://linkedin.com/in/moiz",
                "github": "https://github.com/moiz",
                "website": "https://moiz.dev",
            },
            canonical_key=canonical_key,
        )
        s.add(app)
        await s.commit()
        await s.refresh(app)
        return app.id


async def _drain(sm):
    from app.worker import run_until_idle

    await run_until_idle(
        sm,
        worker_id="w-test",
        concurrency=2,
        max_idle_polls=2,
        poll_sec=0.05,
    )


def _patch_pdf_resolver(monkeypatch, tmp_path):
    """Bypass MinIO + filesystem lookup; just hand the runner a real path."""
    pdf_path = tmp_path / "fake_resume.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n%fake\n%%EOF\n")

    async def fake_resolver(sf, *, resume_id, dest_dir):
        return str(pdf_path)

    monkeypatch.setattr(jobs_runner, "_resolve_resume_pdf", fake_resolver)
    return pdf_path


@pytest.mark.asyncio
async def test_submit_runner_happy_path(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)
    variant_id = await _seed_variant_resume_with_version(sm, tmp_path)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)

    submitted_at = datetime.now(timezone.utc)
    shot_path = str(tmp_path / "shot.png")

    async def fake_submit(ctx, on_progress=None, **kwargs):
        if on_progress is not None:
            await on_progress({"phase": "nav_to_form"})
            await on_progress({"phase": "submitting"})
            await on_progress({"phase": "confirmed"})
        # Return an HTML body larger than nothing but well under the cap.
        return {
            "confirmation_html": "<h1>Thank you</h1>",
            "confirmation_screenshot_path": shot_path,
            "submitted_at": submitted_at,
        }

    monkeypatch.setattr(greenhouse_submit, "submit", fake_submit)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", fake_submit)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded", job.result
        assert job.result["application_id"] == app_id

        app = (
            await s.execute(
                select(Application).where(Application.id == app_id)
            )
        ).scalar_one()
        assert app.status == "submitted"
        assert app.submitted_at is not None
        assert "Thank you" in (app.confirmation_html or "")
        assert app.confirmation_screenshot_path == shot_path
        assert app.error is None

        posting = (
            await s.execute(
                select(JobPosting).where(JobPosting.id == posting_id)
            )
        ).scalar_one()
        assert posting.status == "submitted"

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        phases = [e.phase for e in events]
        assert "confirmed" in phases
        assert "done" in phases


@pytest.mark.asyncio
async def test_submit_runner_dedup_gate(
    monkeypatch, sessionmaker_factory, sqlite_engine, tmp_path
):
    """A sibling Application with the same canonical_key already submitted
    must short-circuit before Playwright is touched.

    The production model carries a unique (user_id, canonical_key) index that
    normally prevents two applications from sharing a key — the gate is a
    defense-in-depth check for races that could leak through the orchestrator
    (e.g., the index being added later, or a manual repair). To exercise the
    gate we drop the index for this test only.
    """
    sm = sessionmaker_factory

    # Drop the unique index so we can seed two rows with the same key.
    async with sqlite_engine.begin() as conn:
        await conn.exec_driver_sql(
            "DROP INDEX IF EXISTS ix_applications_user_canonical_key"
        )

    await _ensure_user(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)
    variant_id = await _seed_variant_resume_with_version(sm, tmp_path)

    canon = "anthropic|jobs/42"

    # Sibling: already submitted with the canonical_key.
    async with sm() as s:
        s.add(
            Application(
                user_id=1,
                posting_id=posting_id,
                mode="B",
                status="submitted",
                resume_variant_id=variant_id,
                cover_letter_text="x",
                form_payload={},
                canonical_key=canon,
                submitted_at=datetime.now(timezone.utc),
            )
        )
        await s.commit()

    # Target: a second posting + application sharing the canonical_key.
    async with sm() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id="42b",
            company_id=company_id,
            title="Backend Engineer (dup)",
            location="Remote",
            apply_url="https://boards.greenhouse.io/anthropic/jobs/42b",
            description_text="dup",
            meta={},
            status="ready",
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        other_posting_id = p.id

    target_app_id = await _seed_application(
        sm,
        posting_id=other_posting_id,
        variant_id=variant_id,
        canonical_key=canon,
        status="prepared",
    )

    called = {"submit": False}

    async def fake_submit(ctx, on_progress=None, **kwargs):
        called["submit"] = True
        return {
            "confirmation_html": "",
            "confirmation_screenshot_path": "",
            "submitted_at": datetime.now(timezone.utc),
        }

    monkeypatch.setattr(greenhouse_submit, "submit", fake_submit)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", fake_submit)

    async with sm() as s:
        jid = await enqueue_submit_application(
            s, application_id=target_app_id
        )
        await s.commit()

    await _drain(sm)

    assert called["submit"] is False

    async with sm() as s:
        job = (
            await s.execute(select(Job).where(Job.id == jid))
        ).scalar_one()
        assert job.status == "succeeded"
        assert job.result["skipped"] is True

        app = (
            await s.execute(
                select(Application).where(Application.id == target_app_id)
            )
        ).scalar_one()
        assert app.status == "duplicate_skipped"


@pytest.mark.asyncio
async def test_submit_runner_handles_missing_field(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)
    variant_id = await _seed_variant_resume_with_version(sm, tmp_path)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)

    async def boom(ctx, on_progress=None, **kwargs):
        raise greenhouse_submit.MissingFieldError("email")

    monkeypatch.setattr(greenhouse_submit, "submit", boom)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", boom)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        assert "missing field: email" in (job.result or {}).get("error", "")

        app = (
            await s.execute(
                select(Application).where(Application.id == app_id)
            )
        ).scalar_one()
        assert app.status == "errored"
        assert "missing field: email" in (app.error or "")


@pytest.mark.asyncio
async def test_submit_runner_handles_confirmation_timeout(
    monkeypatch, sessionmaker_factory, tmp_path
):
    """ConfirmationTimeoutError must persist captured artifacts on the
    Application row even though the row is marked ``errored`` — the submit
    may have actually succeeded server-side and the reviewer needs the HTML
    + screenshot to verify."""
    sm = sessionmaker_factory
    await _ensure_user(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)
    variant_id = await _seed_variant_resume_with_version(sm, tmp_path)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)

    captured_html = "<html><body>maybe submitted</body></html>"
    captured_shot = str(tmp_path / "timeout_shot.png")

    async def boom(ctx, on_progress=None, **kwargs):
        raise greenhouse_submit.ConfirmationTimeoutError(
            "confirmation timeout after 60000ms",
            url="https://boards.greenhouse.io/anthropic/jobs/42",
            title="Application Form",
            confirmation_html=captured_html,
            screenshot_path=captured_shot,
        )

    monkeypatch.setattr(greenhouse_submit, "submit", boom)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", boom)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        assert "confirmation timeout" in (job.result or {}).get("error", "")

        app = (
            await s.execute(
                select(Application).where(Application.id == app_id)
            )
        ).scalar_one()
        assert app.status == "errored"
        assert "confirmation timeout" in (app.error or "")
        assert "submit may have succeeded" in (app.error or "")
        assert app.confirmation_html == captured_html
        assert app.confirmation_screenshot_path == captured_shot


@pytest.mark.asyncio
async def test_submit_runner_handles_generic_failure(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(sm, company_id=company_id)
    variant_id = await _seed_variant_resume_with_version(sm, tmp_path)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)

    async def boom(ctx, on_progress=None, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(greenhouse_submit, "submit", boom)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", boom)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "failed"
        assert "network down" in (job.result or {}).get("error", "")

        app = (
            await s.execute(
                select(Application).where(Application.id == app_id)
            )
        ).scalar_one()
        assert app.status == "errored"
        assert "network down" in (app.error or "")
