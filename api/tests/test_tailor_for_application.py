"""Tests for the KB-aware tailor wrapper."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from sqlalchemy import select

from app.models import JobPosting, Resume, User
from app.services import tailor_for_application as tfa


@dataclass
class _FakeTailorResult:
    variant_latex: str
    pdf: bytes
    page_count: int
    enforced: bool
    iterations: int
    tier_history: list[str]
    keywords_used: list[str]


async def _ensure_user(db) -> None:
    existing = (
        await db.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(id=1))
        await db.commit()


async def _seed_master(db) -> int:
    resume = Resume(
        user_id=1,
        kind="master",
        parent_id=None,
        name="Master",
        template_id="jakes",
        latex_source="\\documentclass{article}\\begin{document}master\\end{document}",
        protected_terms=["Python"],
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume.id


async def _seed_posting(db) -> int:
    posting = JobPosting(
        user_id=1,
        source="greenhouse",
        source_job_id="42",
        title="Senior Backend Engineer",
        location="Remote",
        apply_url="https://example.test/apply/42",
        description_text="We need a Python engineer to scale our infra.",
        meta={},
        status="classified",
    )
    db.add(posting)
    await db.commit()
    await db.refresh(posting)
    return posting.id


def _fake_chunks(n: int) -> list[dict]:
    return [
        {
            "text": f"chunk-{i}-content about the candidate",
            "source": "latex_master",
            "title": "Master Resume",
            "distance": 0.1 * i,
            "document_id": 1,
            "chunk_index": i,
        }
        for i in range(n)
    ]


@pytest.mark.asyncio
async def test_tailor_for_application_threads_kb_chunks(
    monkeypatch, db_session
):
    await _ensure_user(db_session)
    master_id = await _seed_master(db_session)
    posting_id = await _seed_posting(db_session)

    chunks = _fake_chunks(3)

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        assert user_id == 1
        assert k == 8
        return chunks

    monkeypatch.setattr(tfa.kb_ingest, "retrieve", fake_retrieve)

    captured: dict = {}

    async def fake_tailor_resume(**kwargs):
        captured.update(kwargs)
        return _FakeTailorResult(
            variant_latex="\\documentclass{article}\\begin{document}v\\end{document}",
            pdf=b"%PDF-1.4 fake",
            page_count=1,
            enforced=True,
            iterations=1,
            tier_history=["sonnet"],
            keywords_used=["python", "infra"],
        )

    monkeypatch.setattr(tfa, "tailor_resume", fake_tailor_resume)

    out = await tfa.tailor_for_application(
        db_session, user_id=1, posting_id=posting_id
    )

    addendum = captured.get("system_prompt_addendum") or ""
    assert "USER KNOWLEDGE BASE" in addendum
    for c in chunks:
        assert c["text"] in addendum
    assert out["kb_chunks_used"] == 3
    assert out["page_count"] == 1
    assert out["enforced"] is True
    assert out["iterations"] == 1

    # Variant + JD + version snapshot persisted.
    rows = (
        await db_session.execute(
            select(Resume).where(Resume.parent_id == master_id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].id == out["variant_id"]


@pytest.mark.asyncio
async def test_tailor_for_application_no_kb_chunks(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_master(db_session)
    posting_id = await _seed_posting(db_session)

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return []

    monkeypatch.setattr(tfa.kb_ingest, "retrieve", fake_retrieve)

    captured: dict = {}

    async def fake_tailor_resume(**kwargs):
        captured.update(kwargs)
        return _FakeTailorResult(
            variant_latex="\\documentclass{article}\\begin{document}v\\end{document}",
            pdf=b"%PDF-1.4 fake",
            page_count=1,
            enforced=True,
            iterations=1,
            tier_history=["sonnet"],
            keywords_used=[],
        )

    monkeypatch.setattr(tfa, "tailor_resume", fake_tailor_resume)

    out = await tfa.tailor_for_application(
        db_session, user_id=1, posting_id=posting_id
    )

    # Empty KB → no addendum (or None) but tailor still called.
    assert captured.get("system_prompt_addendum") in (None, "")
    assert out["kb_chunks_used"] == 0
