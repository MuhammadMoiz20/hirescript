"""Tests for the manual markdown-folder KB adapter."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import KbChunk, KbDocument
from app.services import kb_ingest
from app.services.kb_sources import markdown_folder


@pytest.fixture(autouse=True)
async def _clean_kb():
    async with SessionLocal() as s:
        await s.execute(delete(KbChunk))
        await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
        await s.commit()
    yield
    async with SessionLocal() as s:
        await s.execute(delete(KbChunk))
        await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
        await s.commit()


def _stub_embed(monkeypatch):
    async def fake_embed(texts):
        return [[0.0] * 1024 for _ in texts]

    monkeypatch.setattr(kb_ingest, "embed", fake_embed)


async def test_two_md_files_create_two_documents(monkeypatch, tmp_path):
    _stub_embed(monkeypatch)
    (tmp_path / "a.md").write_text("# Alpha\n\nbody a")
    (tmp_path / "b.md").write_text("# Bravo\n\nbody b")

    async with SessionLocal() as s:
        out = await markdown_folder.ingest(user_id=1, db=s, root=str(tmp_path))
    assert out == {"created_or_updated": 2, "deleted": 0}

    async with SessionLocal() as s:
        docs = (
            await s.execute(select(KbDocument).where(KbDocument.source == "markdown"))
        ).scalars().all()
        assert len(docs) == 2
        titles = {d.title for d in docs}
        assert titles == {"Alpha", "Bravo"}


async def test_modify_then_reingest_rebuilds_chunks(monkeypatch, tmp_path):
    _stub_embed(monkeypatch)
    (tmp_path / "a.md").write_text("# Alpha\n\nshort")
    (tmp_path / "b.md").write_text("# Bravo\n\nbravo body")

    async with SessionLocal() as s:
        await markdown_folder.ingest(user_id=1, db=s, root=str(tmp_path))

    async with SessionLocal() as s:
        a_doc = (
            await s.execute(
                select(KbDocument).where(
                    KbDocument.source == "markdown", KbDocument.source_id == "a.md"
                )
            )
        ).scalar_one()
        b_doc = (
            await s.execute(
                select(KbDocument).where(
                    KbDocument.source == "markdown", KbDocument.source_id == "b.md"
                )
            )
        ).scalar_one()
        a_chunks_before = (
            await s.execute(select(KbChunk).where(KbChunk.document_id == a_doc.id))
        ).scalars().all()
        b_chunks_before = (
            await s.execute(select(KbChunk).where(KbChunk.document_id == b_doc.id))
        ).scalars().all()
        b_ids_before = sorted(c.id for c in b_chunks_before)

    long_body = "## Section A\n\n" + ("paragraph text. " * 200) + "\n\n## Section B\n\nmore"
    (tmp_path / "a.md").write_text(f"# Alpha\n\n{long_body}")

    async with SessionLocal() as s:
        out = await markdown_folder.ingest(user_id=1, db=s, root=str(tmp_path))
    assert out["created_or_updated"] == 2
    assert out["deleted"] == 0

    async with SessionLocal() as s:
        a_chunks_after = (
            await s.execute(select(KbChunk).where(KbChunk.document_id == a_doc.id))
        ).scalars().all()
        b_chunks_after = (
            await s.execute(select(KbChunk).where(KbChunk.document_id == b_doc.id))
        ).scalars().all()
        b_ids_after = sorted(c.id for c in b_chunks_after)
    assert len(a_chunks_after) != len(a_chunks_before)
    assert b_ids_after == b_ids_before


async def test_delete_then_reingest_cascades(monkeypatch, tmp_path):
    _stub_embed(monkeypatch)
    (tmp_path / "a.md").write_text("# Alpha\n\naaa")
    (tmp_path / "b.md").write_text("# Bravo\n\nbbb")

    async with SessionLocal() as s:
        await markdown_folder.ingest(user_id=1, db=s, root=str(tmp_path))

    (tmp_path / "a.md").unlink()

    async with SessionLocal() as s:
        out = await markdown_folder.ingest(user_id=1, db=s, root=str(tmp_path))
    assert out["deleted"] == 1
    assert out["created_or_updated"] == 1

    async with SessionLocal() as s:
        docs = (
            await s.execute(select(KbDocument).where(KbDocument.source == "markdown"))
        ).scalars().all()
        assert len(docs) == 1
        assert docs[0].source_id == "b.md"
        chunks = (
            await s.execute(select(KbChunk).where(KbChunk.document_id == docs[0].id))
        ).scalars().all()
        assert len(chunks) >= 1


async def test_missing_root_returns_zero_counts(monkeypatch, tmp_path):
    _stub_embed(monkeypatch)
    async with SessionLocal() as s:
        out = await markdown_folder.ingest(
            user_id=1, db=s, root=str(tmp_path / "does-not-exist")
        )
    assert out == {"created_or_updated": 0, "deleted": 0}


async def test_no_h1_uses_filename_stem(monkeypatch, tmp_path):
    _stub_embed(monkeypatch)
    (tmp_path / "career-notes.md").write_text("just body, no heading")
    async with SessionLocal() as s:
        await markdown_folder.ingest(user_id=1, db=s, root=str(tmp_path))
        doc = (
            await s.execute(select(KbDocument).where(KbDocument.source == "markdown"))
        ).scalar_one()
        assert doc.title == "career-notes"
