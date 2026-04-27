"""Tests for the Haiku-backed verify pass.

The verifier reads a tailored application's resume + cover letter and
judges whether every concrete claim is grounded in the user's profile or
KB notes. It never edits the materials — only returns a verdict.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import (
    Application,
    Company,
    JobPosting,
    Profile as ProfileModel,
    Resume,
    User,
)
from app.services import claude_router, verify
from app.services.agent import AgentError


async def _ensure_user(db) -> None:
    existing = (
        await db.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(id=1))
        await db.commit()


async def _seed_world(db_session) -> int:
    """Seed the minimum fixture for verify_application: profile, posting,
    variant resume, and an application that references both."""
    await _ensure_user(db_session)
    db_session.add(
        ProfileModel(
            user_id=1,
            data={
                "legal_name": "Moiz Zahid",
                "preferences": {"role_families": ["backend"]},
            },
        )
    )
    company = Company(
        slug="anthropic", display_name="Anthropic", source="greenhouse"
    )
    db_session.add(company)
    await db_session.flush()
    posting = JobPosting(
        user_id=1,
        source="greenhouse",
        source_job_id="42",
        company_id=company.id,
        title="Backend Engineer",
        location="Remote",
        apply_url="https://boards.greenhouse.io/anthropic/jobs/42",
        description_text="Build distributed systems in Rust.",
        meta={},
        status="classified",
    )
    db_session.add(posting)
    await db_session.flush()
    master = Resume(
        user_id=1,
        kind="master",
        name="Master",
        template_id="jakes",
        latex_source=r"\documentclass{article}\begin{document}m\end{document}",
        protected_terms=[],
    )
    db_session.add(master)
    await db_session.flush()
    variant = Resume(
        user_id=1,
        parent_id=master.id,
        kind="variant",
        name="Variant",
        template_id="jakes",
        latex_source=r"\documentclass{article}\begin{document}TAILORED LATEX\end{document}",
        protected_terms=[],
    )
    db_session.add(variant)
    await db_session.flush()
    app = Application(
        user_id=1,
        posting_id=posting.id,
        mode="B",
        status="prepared",
        resume_variant_id=variant.id,
        cover_letter_text="My cover letter mentioning Rust experience.",
        form_payload={},
        canonical_key="anthropic|jobs/42",
    )
    db_session.add(app)
    await db_session.commit()
    return app.id


def _stub_query_json(monkeypatch, payload):
    """Patch ``verify.query_json`` to return a fixed payload (or raise).

    ``payload`` may be a dict (returned), an Exception (raised), or a callable
    receiving the kwargs and returning a value.
    """
    async def _fake(**kwargs):
        if isinstance(payload, Exception):
            raise payload
        if callable(payload):
            return payload(**kwargs)
        return payload

    monkeypatch.setattr(verify, "query_json", _fake)


@pytest.mark.asyncio
async def test_verify_application_returns_ok_true(monkeypatch, db_session):
    application_id = await _seed_world(db_session)

    _stub_query_json(
        monkeypatch,
        {"ok": True, "issues": [], "rationale": "All grounded."},
    )

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return [{"text": "I worked with Rust at $previous", "source": "notes", "title": "x"}]

    monkeypatch.setattr(verify.kb_ingest, "retrieve", fake_retrieve)

    result = await verify.verify_application(
        db_session, application_id=application_id
    )
    assert result["ok"] is True
    assert result["issues"] == []
    assert "grounded" in result["rationale"].lower()


@pytest.mark.asyncio
async def test_verify_application_propagates_ok_false(
    monkeypatch, db_session
):
    application_id = await _seed_world(db_session)

    _stub_query_json(
        monkeypatch,
        {
            "ok": False,
            "issues": ["Claims PhD but no PhD in profile."],
            "rationale": "One unsupported claim found.",
        },
    )

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return []

    monkeypatch.setattr(verify.kb_ingest, "retrieve", fake_retrieve)

    result = await verify.verify_application(
        db_session, application_id=application_id
    )
    assert result["ok"] is False
    assert result["issues"] == ["Claims PhD but no PhD in profile."]


@pytest.mark.asyncio
async def test_verify_application_invalid_json_raises(
    monkeypatch, db_session
):
    application_id = await _seed_world(db_session)

    _stub_query_json(monkeypatch, AgentError("invalid JSON: bad; got xxx"))

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return []

    monkeypatch.setattr(verify.kb_ingest, "retrieve", fake_retrieve)

    with pytest.raises(AgentError):
        await verify.verify_application(
            db_session, application_id=application_id
        )


@pytest.mark.asyncio
async def test_verify_application_uses_router_with_verify_kind(
    monkeypatch, db_session
):
    application_id = await _seed_world(db_session)

    _stub_query_json(
        monkeypatch,
        {"ok": True, "issues": [], "rationale": "ok"},
    )

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return []

    monkeypatch.setattr(verify.kb_ingest, "retrieve", fake_retrieve)

    captured: dict = {}
    real_choose = claude_router.choose

    async def spying_choose(db, *, task_kind, tier_slug=None):
        captured["task_kind"] = task_kind
        return await real_choose(db, task_kind=task_kind, tier_slug=tier_slug)

    monkeypatch.setattr(verify.claude_router, "choose", spying_choose)

    await verify.verify_application(
        db_session, application_id=application_id
    )
    assert captured["task_kind"] == "verify"

    # And a usage row was recorded with task_kind=verify.
    from app.models import ClaudeUsage

    rows = (await db_session.execute(select(ClaudeUsage))).scalars().all()
    assert any(r.task_kind == "verify" for r in rows)
