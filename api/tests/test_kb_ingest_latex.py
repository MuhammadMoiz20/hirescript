"""Tests for the KB ingest service and the master-LaTeX adapter.

Runs against the live Postgres test database (pgvector required for the
``KbChunk.embedding`` column).
"""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import JobDescription, KbChunk, KbDocument, Resume, ResumeVersion
from app.services import kb_ingest
from app.services.kb_sources import latex_master


@pytest.fixture(autouse=True)
async def _clean_kb():
    """Wipe Resume + KB rows for user_id=1 before each test."""
    async with SessionLocal() as s:
        await s.execute(delete(KbChunk))
        await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
        await s.execute(delete(ResumeVersion))
        await s.execute(delete(Resume).where(Resume.user_id == 1))
        await s.execute(delete(JobDescription).where(JobDescription.user_id == 1))
        await s.commit()
    yield
    async with SessionLocal() as s:
        await s.execute(delete(KbChunk))
        await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
        await s.execute(delete(ResumeVersion))
        await s.execute(delete(Resume).where(Resume.user_id == 1))
        await s.execute(delete(JobDescription).where(JobDescription.user_id == 1))
        await s.commit()


def _stub_embed(monkeypatch):
    calls = {"n": 0, "texts": []}

    async def fake_embed(texts):
        calls["n"] += 1
        calls["texts"].append(list(texts))
        return [[0.0] * 1024 for _ in texts]

    monkeypatch.setattr(kb_ingest, "embed", fake_embed)
    return calls


async def test_latex_master_ingest_creates_document_and_chunks(monkeypatch):
    _stub_embed(monkeypatch)
    latex = (
        "\\documentclass{article}\\begin{document}"
        "\\section{Experience}\nWorked on a thing at Acme.\n"
        "\\section{Education}\nState University, BS CS.\n"
        "\\end{document}"
    )
    async with SessionLocal() as s:
        r = Resume(
            user_id=1,
            kind="master",
            name="master",
            template_id="jakes",
            latex_source=latex,
        )
        s.add(r)
        await s.commit()
        resume_id = r.id

    async with SessionLocal() as s:
        doc = await latex_master.ingest(user_id=1, db=s)
    assert doc is not None
    assert doc.source == "latex_master"
    assert doc.source_id == str(resume_id)
    assert doc.title == "Master Resume"

    async with SessionLocal() as s:
        docs = (
            await s.execute(select(KbDocument).where(KbDocument.source == "latex_master"))
        ).scalars().all()
        assert len(docs) == 1
        chunks = (
            await s.execute(select(KbChunk).where(KbChunk.document_id == docs[0].id))
        ).scalars().all()
        assert len(chunks) >= 1


async def test_re_ingest_with_same_content_is_noop(monkeypatch):
    calls = _stub_embed(monkeypatch)
    latex = (
        "\\documentclass{article}\\begin{document}"
        "\\section{Experience}\nWorked at Acme on widgets.\n"
        "\\end{document}"
    )
    async with SessionLocal() as s:
        s.add(
            Resume(
                user_id=1,
                kind="master",
                name="m",
                template_id="jakes",
                latex_source=latex,
            )
        )
        await s.commit()

    async with SessionLocal() as s:
        await latex_master.ingest(user_id=1, db=s)
    async with SessionLocal() as s:
        first = (
            await s.execute(select(KbChunk))
        ).scalars().all()
        first_count = len(first)

    async with SessionLocal() as s:
        await latex_master.ingest(user_id=1, db=s)
    async with SessionLocal() as s:
        second = (
            await s.execute(select(KbChunk))
        ).scalars().all()
        assert len(second) == first_count

    assert calls["n"] == 1


async def test_no_master_resume_returns_none(monkeypatch):
    _stub_embed(monkeypatch)
    async with SessionLocal() as s:
        out = await latex_master.ingest(user_id=1, db=s)
        assert out is None
