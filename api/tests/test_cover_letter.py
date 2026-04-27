"""Tests for the cover letter generator."""

from __future__ import annotations

import logging

import pytest
from sqlalchemy import select

from app.models import ClaudeUsage, JobPosting, Profile as ProfileModel, User
from app.services import cover_letter as cl


async def _ensure_user(db) -> None:
    existing = (
        await db.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(id=1))
        await db.commit()


async def _seed_profile(db) -> None:
    db.add(
        ProfileModel(
            user_id=1,
            data={
                "legal_name": "Moiz Zahid",
                "links": {"github": "https://github.com/moiz"},
                "preferences": {"role_families": ["backend"]},
            },
        )
    )
    await db.commit()


async def _seed_posting(db) -> int:
    p = JobPosting(
        user_id=1,
        source="greenhouse",
        source_job_id="9",
        title="Backend Engineer",
        location="Remote",
        apply_url="https://example.test/apply/9",
        description_text="Help us build distributed systems at scale.",
        meta={},
        status="classified",
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p.id


@pytest.mark.asyncio
async def test_cover_letter_includes_kb_chunks_in_prompt(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    chunks = [
        {
            "text": "Built a low-latency API gateway in Python.",
            "source": "latex_master",
            "title": "Master Resume",
            "distance": 0.1,
            "document_id": 1,
            "chunk_index": 0,
        },
        {
            "text": "Led migration of monolith to microservices.",
            "source": "notes",
            "title": "Career Notes",
            "distance": 0.15,
            "document_id": 2,
            "chunk_index": 0,
        },
    ]

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        assert k == 6
        return chunks

    monkeypatch.setattr(cl.kb_ingest, "retrieve", fake_retrieve)

    captured: dict = {}

    async def fake_query_text(*, system_prompt, user_prompt, tier):
        captured["system"] = system_prompt
        captured["user"] = user_prompt
        captured["tier"] = tier
        return "Cover letter text"

    monkeypatch.setattr(cl, "query_text", fake_query_text)

    out = await cl.generate_cover_letter(
        db_session, user_id=1, posting_id=posting_id
    )

    assert out == "Cover letter text"
    assert captured["tier"] == "sonnet"
    assert "Moiz Zahid" in captured["system"]
    for c in chunks:
        assert c["text"] in captured["user"]
    assert "Backend Engineer" in captured["user"]

    # claude_router.record_usage wrote a row for the cover_letter task.
    usage = (
        await db_session.execute(select(ClaudeUsage))
    ).scalars().all()
    assert len(usage) == 1
    assert usage[0].task_kind == "cover_letter"
    assert usage[0].client == "api"


@pytest.mark.asyncio
async def test_cover_letter_logs_when_over_word_cap(
    monkeypatch, db_session, caplog
):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return []

    monkeypatch.setattr(cl.kb_ingest, "retrieve", fake_retrieve)

    long_text = " ".join(f"word{i}" for i in range(300))

    async def fake_query_text(*, system_prompt, user_prompt, tier):
        return long_text

    monkeypatch.setattr(cl, "query_text", fake_query_text)

    with caplog.at_level(logging.WARNING, logger=cl.log.name):
        out = await cl.generate_cover_letter(
            db_session, user_id=1, posting_id=posting_id
        )

    assert out == long_text
    assert "exceeded 250-word soft cap" in caplog.text


@pytest.mark.asyncio
async def test_cover_letter_with_empty_kb(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    async def fake_retrieve(db, *, user_id, query, k=8, source_filter=None):
        return []

    monkeypatch.setattr(cl.kb_ingest, "retrieve", fake_retrieve)

    async def fake_query_text(*, system_prompt, user_prompt, tier):
        return "Generated letter."

    monkeypatch.setattr(cl, "query_text", fake_query_text)

    out = await cl.generate_cover_letter(
        db_session, user_id=1, posting_id=posting_id
    )
    assert out == "Generated letter."
