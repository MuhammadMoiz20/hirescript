"""Behavioral tests for the A-mode branch of ``run_submit_application_job``.

Covers:
- Cap-hit (today's submitted count for the tier already at cap) — no submit,
  application stays prepared, job marked succeeded with a skip reason.
- Verify-blocked (verify_ok is False) — no submit, notification sent, status
  stays prepared.
- Captcha pause — adapter raises CaptchaPauseRequired; runner persists the
  screenshot, sets status='captcha_pause', writes a notification.
- Happy path — adapter succeeds; status transitions to 'submitted'.
- AUTONOMOUS_SUBMIT_DISABLED kill switch — short-circuits with a 'disabled' event.

Greenhouse adapter is monkeypatched. ntfy is monkeypatched at the httpx
level inside the notifications service.
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
    Notification,
    Resume,
    ResumeVersion,
    Tier,
    User,
)
from app.services import jobs_runner
from app.services.jobs_repo import enqueue_submit_application
from app.services.submit_adapters import greenhouse as greenhouse_submit


# --- shared helpers ---------------------------------------------------------


async def _ensure_user(sm) -> None:
    async with sm() as s:
        existing = (
            await s.execute(select(User).where(User.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            s.add(User(id=1))
            await s.commit()


async def _seed_tier(sm, *, slug: str = "targeted", daily_cap: int = 20) -> int:
    async with sm() as s:
        t = Tier(
            slug=slug,
            display_name=slug,
            min_fit_score=65,
            daily_cap=daily_cap,
            default_mode="A",
            tailor_model="sonnet-4.6",
            classify_model="haiku-4.5",
            enabled=True,
        )
        s.add(t)
        await s.commit()
        await s.refresh(t)
        return t.id


async def _seed_company(sm, slug: str = "anthropic") -> int:
    async with sm() as s:
        c = Company(slug=slug, display_name="Anthropic", source="greenhouse")
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.id


async def _seed_posting(
    sm,
    *,
    company_id: int,
    source_job_id: str = "42",
    tier: str = "targeted",
) -> int:
    async with sm() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id=source_job_id,
            company_id=company_id,
            title="Backend Engineer",
            location="Remote",
            apply_url=f"https://boards.greenhouse.io/anthropic/jobs/{source_job_id}",
            description_text="desc",
            meta={},
            tier=tier,
            fit_score=70,
            status="ready",
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        return p.id


async def _seed_variant_resume_with_version(sm) -> int:
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
    sm,
    *,
    posting_id: int,
    variant_id: int,
    canonical_key: str,
    mode: str = "A",
    status: str = "prepared",
    verify_ok: bool | None = True,
) -> int:
    async with sm() as s:
        app = Application(
            user_id=1,
            posting_id=posting_id,
            mode=mode,
            status=status,
            resume_variant_id=variant_id,
            cover_letter_text="Cover.",
            form_payload={
                "first_name": "Moiz",
                "last_name": "Zahid",
                "email": "moiz@example.com",
                "phone": "+15555550100",
            },
            canonical_key=canonical_key,
            verify_ok=verify_ok,
            verify_issues=[],
        )
        s.add(app)
        await s.commit()
        await s.refresh(app)
        return app.id


def _patch_pdf_resolver(monkeypatch, tmp_path):
    pdf_path = tmp_path / "fake_resume.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n%fake\n%%EOF\n")

    async def fake_resolver(sf, *, resume_id, dest_dir):
        return str(pdf_path)

    monkeypatch.setattr(jobs_runner, "_resolve_resume_pdf", fake_resolver)
    return pdf_path


def _patch_ntfy(monkeypatch):
    """Capture ntfy POSTs via a fake httpx.AsyncClient on the notifications service."""

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            return None

    class _Client:
        def __init__(self, capture):
            self._capture = capture

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, url, *, content=None, headers=None, **kwargs):
            self._capture.append(
                {"url": url, "content": content, "headers": dict(headers or {})}
            )
            return _Resp()

    captured: list[dict] = []
    import httpx
    from app.services import notifications

    def fake_factory(*args, **kwargs):
        return _Client(captured)

    monkeypatch.setattr(notifications.httpx, "AsyncClient", fake_factory)
    monkeypatch.setattr(httpx, "AsyncClient", fake_factory)
    monkeypatch.setenv("NTFY_TOPIC", "hirescript-test")
    return captured


async def _drain(sm):
    from app.worker import run_until_idle

    await run_until_idle(
        sm,
        worker_id="w-test",
        concurrency=2,
        max_idle_polls=2,
        poll_sec=0.05,
    )


# --- tests ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_amode_cap_hit_skips_submit(
    monkeypatch, sessionmaker_factory, sqlite_engine, tmp_path
):
    sm = sessionmaker_factory
    # Drop the unique canonical_key index so we can seed a sibling submission.
    async with sqlite_engine.begin() as conn:
        await conn.exec_driver_sql(
            "DROP INDEX IF EXISTS ix_applications_user_canonical_key"
        )

    await _ensure_user(sm)
    await _seed_tier(sm, slug="targeted", daily_cap=1)
    company_id = await _seed_company(sm)
    other_posting_id = await _seed_posting(
        sm, company_id=company_id, source_job_id="100", tier="targeted"
    )
    posting_id = await _seed_posting(
        sm, company_id=company_id, source_job_id="42", tier="targeted"
    )
    variant_id = await _seed_variant_resume_with_version(sm)

    # Sibling application already submitted today on the targeted tier —
    # consumes the cap of 1.
    async with sm() as s:
        s.add(
            Application(
                user_id=1,
                posting_id=other_posting_id,
                mode="A",
                status="submitted",
                resume_variant_id=variant_id,
                cover_letter_text="x",
                form_payload={},
                canonical_key="anthropic|jobs/100",
                submitted_at=datetime.now(timezone.utc),
                verify_ok=True,
            )
        )
        await s.commit()

    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
        mode="A",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)
    _patch_ntfy(monkeypatch)

    called = {"submit": False}

    async def fake_submit(ctx, on_progress=None, on_captcha=None, **kwargs):
        called["submit"] = True
        return {
            "confirmation_html": "",
            "confirmation_screenshot_path": "",
            "submitted_at": datetime.now(timezone.utc),
        }

    monkeypatch.setattr(greenhouse_submit, "submit", fake_submit)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", fake_submit)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    assert called["submit"] is False

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["skipped"] is True
        assert job.result["reason"] == "cap_hit"

        app = (
            await s.execute(select(Application).where(Application.id == app_id))
        ).scalar_one()
        assert app.status == "prepared"

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        phases = [e.phase for e in events]
        assert "cap_hit" in phases


@pytest.mark.asyncio
async def test_amode_verify_blocked_skips_and_notifies(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_tier(sm, slug="targeted", daily_cap=20)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(
        sm, company_id=company_id, tier="targeted"
    )
    variant_id = await _seed_variant_resume_with_version(sm)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
        mode="A",
        verify_ok=False,
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)
    captured = _patch_ntfy(monkeypatch)

    called = {"submit": False}

    async def fake_submit(ctx, on_progress=None, on_captcha=None, **kwargs):
        called["submit"] = True
        return {
            "confirmation_html": "",
            "confirmation_screenshot_path": "",
            "submitted_at": datetime.now(timezone.utc),
        }

    monkeypatch.setattr(greenhouse_submit, "submit", fake_submit)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", fake_submit)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    assert called["submit"] is False

    async with sm() as s:
        app = (
            await s.execute(select(Application).where(Application.id == app_id))
        ).scalar_one()
        assert app.status == "prepared"

        notes = (
            await s.execute(
                select(Notification).where(Notification.user_id == 1)
            )
        ).scalars().all()
        kinds = [n.kind for n in notes]
        assert "verify_blocked" in kinds
        assert any(
            (n.meta or {}).get("application_id") == app_id for n in notes
        )

    # ntfy POST fired with the correct envelope.
    assert any(c["url"].endswith("/hirescript-test") for c in captured)


@pytest.mark.asyncio
async def test_amode_captcha_pause_persists_artifacts_and_notifies(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_tier(sm, slug="targeted", daily_cap=20)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(
        sm, company_id=company_id, tier="targeted"
    )
    variant_id = await _seed_variant_resume_with_version(sm)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
        mode="A",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)
    captured = _patch_ntfy(monkeypatch)

    # Adapter mock: invoke on_captcha (so the runner persists artifacts)
    # then raise CaptchaPauseRequired exactly like the real adapter.
    async def fake_submit(ctx, on_progress=None, on_captcha=None, **kwargs):
        cap_ctx = {
            "url": "https://boards.greenhouse.io/anthropic/jobs/42",
            "screenshot_png": b"\x89PNG\r\n\x1a\nfake-png-bytes",
        }
        if on_captcha is not None:
            await on_captcha(cap_ctx)
        raise greenhouse_submit.CaptchaPauseRequired(cap_ctx)

    monkeypatch.setattr(greenhouse_submit, "submit", fake_submit)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", fake_submit)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["reason"] == "captcha_pause"

        app = (
            await s.execute(select(Application).where(Application.id == app_id))
        ).scalar_one()
        assert app.status == "captcha_pause"
        assert app.confirmation_screenshot_path  # path was stored
        # Screenshot bytes were written.
        from pathlib import Path
        path = Path(app.confirmation_screenshot_path)
        assert path.exists()
        assert path.read_bytes().startswith(b"\x89PNG")

        notes = (
            await s.execute(
                select(Notification).where(Notification.user_id == 1)
            )
        ).scalars().all()
        kinds = [n.kind for n in notes]
        assert "captcha_pause" in kinds

    # ntfy POST envelope sanity-check.
    assert captured, "expected at least one ntfy POST"
    first = captured[0]
    assert first["url"] == "https://ntfy.sh/hirescript-test"
    assert first["headers"].get("Title") == "Captcha required"


@pytest.mark.asyncio
async def test_amode_happy_path_submits(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_tier(sm, slug="targeted", daily_cap=20)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(
        sm, company_id=company_id, tier="targeted"
    )
    variant_id = await _seed_variant_resume_with_version(sm)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
        mode="A",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)
    _patch_ntfy(monkeypatch)

    submitted_at = datetime.now(timezone.utc)
    shot_path = str(tmp_path / "shot.png")
    (tmp_path / "shot.png").write_bytes(b"png")

    seen_on_captcha = {"value": "unset"}

    async def fake_submit(ctx, on_progress=None, on_captcha=None, **kwargs):
        seen_on_captcha["value"] = on_captcha
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

    # A-mode wires an on_captcha callback (B-mode passes None).
    assert seen_on_captcha["value"] is not None

    async with sm() as s:
        app = (
            await s.execute(select(Application).where(Application.id == app_id))
        ).scalar_one()
        assert app.status == "submitted"
        assert app.submitted_at is not None
        assert "Thank you" in (app.confirmation_html or "")


@pytest.mark.asyncio
async def test_amode_kill_switch_short_circuits(
    monkeypatch, sessionmaker_factory, tmp_path
):
    sm = sessionmaker_factory
    await _ensure_user(sm)
    await _seed_tier(sm, slug="targeted", daily_cap=20)
    company_id = await _seed_company(sm)
    posting_id = await _seed_posting(
        sm, company_id=company_id, tier="targeted"
    )
    variant_id = await _seed_variant_resume_with_version(sm)
    app_id = await _seed_application(
        sm,
        posting_id=posting_id,
        variant_id=variant_id,
        canonical_key="anthropic|jobs/42",
        mode="A",
    )

    _patch_pdf_resolver(monkeypatch, tmp_path)
    _patch_ntfy(monkeypatch)
    monkeypatch.setenv("AUTONOMOUS_SUBMIT_DISABLED", "1")

    called = {"submit": False}

    async def fake_submit(ctx, on_progress=None, on_captcha=None, **kwargs):
        called["submit"] = True
        return {
            "confirmation_html": "",
            "confirmation_screenshot_path": "",
            "submitted_at": datetime.now(timezone.utc),
        }

    monkeypatch.setattr(greenhouse_submit, "submit", fake_submit)
    monkeypatch.setattr(jobs_runner.greenhouse_submit, "submit", fake_submit)

    async with sm() as s:
        jid = await enqueue_submit_application(s, application_id=app_id)
        await s.commit()

    await _drain(sm)

    assert called["submit"] is False

    async with sm() as s:
        job = (await s.execute(select(Job).where(Job.id == jid))).scalar_one()
        assert job.status == "succeeded"
        assert job.result["reason"] == "autonomous_submit_disabled"

        events = (
            await s.execute(select(JobEvent).where(JobEvent.job_id == jid))
        ).scalars().all()
        assert any(e.phase == "disabled" for e in events)
