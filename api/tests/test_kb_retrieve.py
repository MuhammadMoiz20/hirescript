"""Tests for ``kb_ingest.retrieve`` cosine-similarity ranking."""

from __future__ import annotations

import pytest
from sqlalchemy import delete

from app.db import SessionLocal
from app.models import KbChunk, KbDocument
from app.services import kb_ingest


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


def _vec_for(char: str) -> list[float]:
    """Deterministic 1024-d unit vector keyed on the first character.

    Each character maps to a distinct one-hot dimension so cosine distance
    between distinct chars is 1.0 and identical chars is 0.0 — easy to reason
    about for ranking assertions.
    """
    idx = ord(char[:1] or " ") % 1024
    v = [0.0] * 1024
    v[idx] = 1.0
    return v


def _patch_embed(monkeypatch):
    async def fake_embed(texts):
        return [_vec_for(t[:1] or " ") for t in texts]

    monkeypatch.setattr(kb_ingest, "embed", fake_embed)


async def _seed(db, *, source: str, source_id: str, text: str, title: str | None = None):
    return await kb_ingest.ingest_document(
        db,
        user_id=1,
        source=source,
        source_id=source_id,
        title=title or source_id,
        raw_text=text,
    )


async def test_retrieve_ranks_closest_chunk_first(monkeypatch):
    _patch_embed(monkeypatch)

    async with SessionLocal() as s:
        await _seed(s, source="markdown", source_id="a.md", text="alpha body about apples")
        await _seed(s, source="markdown", source_id="m.md", text="mango body about mangos")
        await _seed(s, source="markdown", source_id="z.md", text="zebra body about zoos")

    async def fake_query(text):
        return _vec_for("z")

    monkeypatch.setattr(kb_ingest.embeddings, "embed_query", fake_query)

    async with SessionLocal() as s:
        results = await kb_ingest.retrieve(s, user_id=1, query="zebra")

    assert len(results) == 3
    assert results[0]["text"].startswith("zebra")
    # Distance to identical-key vector should be ~0
    assert results[0]["distance"] < results[1]["distance"]
    assert results[0]["source"] == "markdown"
    assert results[0]["title"] == "z.md"


async def test_retrieve_filters_by_source(monkeypatch):
    _patch_embed(monkeypatch)

    async with SessionLocal() as s:
        await _seed(s, source="markdown", source_id="m.md", text="markdown content")
        await _seed(s, source="latex_master", source_id="1", text="latex content")

    async def fake_query(text):
        return _vec_for("m")

    monkeypatch.setattr(kb_ingest.embeddings, "embed_query", fake_query)

    async with SessionLocal() as s:
        results = await kb_ingest.retrieve(
            s, user_id=1, query="anything", source_filter=["markdown"]
        )

    assert len(results) == 1
    assert results[0]["source"] == "markdown"


async def test_retrieve_respects_k(monkeypatch):
    _patch_embed(monkeypatch)

    async with SessionLocal() as s:
        await _seed(s, source="markdown", source_id="a.md", text="alpha")
        await _seed(s, source="markdown", source_id="b.md", text="bravo")
        await _seed(s, source="markdown", source_id="c.md", text="charlie")

    async def fake_query(text):
        return _vec_for("a")

    monkeypatch.setattr(kb_ingest.embeddings, "embed_query", fake_query)

    async with SessionLocal() as s:
        results = await kb_ingest.retrieve(s, user_id=1, query="x", k=2)

    assert len(results) == 2
