"""Tests for KB sources/documents API routes."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.main import app
from app.models import KbChunk, KbDocument, Resume, ResumeVersion
from app.services import kb_ingest
from app.services.kb_sources import markdown_folder

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_kb():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(delete(KbChunk))
            await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
            await s.execute(
                delete(ResumeVersion).where(
                    ResumeVersion.resume_id.in_(
                        select(Resume.id).where(Resume.user_id == 1)
                    )
                )
            )
            await s.execute(delete(Resume).where(Resume.user_id == 1))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _stub_embed(monkeypatch):
    async def fake_embed(texts):
        return [[0.0] * 1024 for _ in texts]

    monkeypatch.setattr(kb_ingest, "embed", fake_embed)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


class _Authed:
    def __init__(self, cookies):
        self._cookies = cookies

    def get(self, url):
        return client.get(url, cookies=self._cookies)

    def post(self, url, json=None):
        return client.post(url, json=json, cookies=self._cookies)

    def delete(self, url):
        return client.delete(url, cookies=self._cookies)


@pytest.fixture
def client_authed():
    return _Authed(_login())


def _seed_doc(source: str, source_id: str, title: str, monkeypatch):
    _stub_embed(monkeypatch)

    async def _run():
        async with SessionLocal() as s:
            return await kb_ingest.ingest_document(
                s,
                user_id=1,
                source=source,
                source_id=source_id,
                title=title,
                raw_text=f"# {title}\n\nbody for {source_id}",
            )

    return asyncio.run(_run())


def test_get_kb_sources_requires_auth():
    r = client.get("/kb/sources")
    assert r.status_code == 401


def test_get_kb_sources_returns_known_sources_even_when_empty(client_authed):
    r = client_authed.get("/kb/sources")
    assert r.status_code == 200
    body = r.json()
    sources = {s["source"] for s in body}
    assert sources == {"latex_master", "markdown"}
    for s in body:
        assert s["document_count"] == 0
        assert s["chunk_count"] == 0
        assert s["last_synced_at"] is None


def test_get_kb_sources_aggregates_counts(client_authed, monkeypatch):
    _seed_doc("markdown", "a.md", "Alpha", monkeypatch)
    _seed_doc("markdown", "b.md", "Bravo", monkeypatch)
    r = client_authed.get("/kb/sources")
    assert r.status_code == 200
    by_src = {s["source"]: s for s in r.json()}
    assert by_src["markdown"]["document_count"] == 2
    assert by_src["markdown"]["chunk_count"] >= 2
    assert by_src["markdown"]["last_synced_at"] is not None
    assert by_src["latex_master"]["document_count"] == 0


def test_post_sync_unknown_source_returns_404(client_authed):
    r = client_authed.post("/kb/sources/notion/sync")
    assert r.status_code == 404
    assert r.json()["detail"] == "Unknown source"


def test_post_sync_markdown_runs_adapter(client_authed, monkeypatch):
    _stub_embed(monkeypatch)

    async def fake_ingest(*, user_id, db, root="/app/kb"):
        return {"created_or_updated": 3, "deleted": 1}

    monkeypatch.setattr(markdown_folder, "ingest", fake_ingest)
    # Also patch the symbol imported into the routes module
    from app.routes import kb as kb_routes

    monkeypatch.setattr(kb_routes.markdown_folder, "ingest", fake_ingest)

    r = client_authed.post("/kb/sources/markdown/sync")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "markdown"
    assert body["created_or_updated"] == 3
    assert body["deleted"] == 1
    assert "document_count" in body
    assert "chunk_count" in body


def test_post_sync_latex_master_with_no_resume(client_authed, monkeypatch):
    _stub_embed(monkeypatch)
    r = client_authed.post("/kb/sources/latex_master/sync")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "latex_master"
    assert body["document_count"] == 0
    assert body["chunk_count"] == 0


def test_get_kb_documents_paginates(client_authed, monkeypatch):
    _seed_doc("markdown", "a.md", "Alpha", monkeypatch)
    _seed_doc("markdown", "b.md", "Bravo", monkeypatch)
    _seed_doc("markdown", "c.md", "Charlie", monkeypatch)

    r = client_authed.get("/kb/documents?limit=2")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
    for item in body["items"]:
        assert "id" in item
        assert "source" in item
        assert "title" in item
        assert "fetched_at" in item
        assert "chunk_count" in item


def test_get_kb_documents_filters_by_source(client_authed, monkeypatch):
    _seed_doc("markdown", "a.md", "Alpha", monkeypatch)
    _seed_doc("latex_master", "1", "Master Resume", monkeypatch)

    r = client_authed.get("/kb/documents?source=markdown")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["source"] == "markdown"


def test_delete_kb_document_cascades(client_authed, monkeypatch):
    doc = _seed_doc("markdown", "a.md", "Alpha", monkeypatch)
    doc_id = doc.id

    r = client_authed.delete(f"/kb/documents/{doc_id}")
    assert r.status_code == 204

    r2 = client_authed.get("/kb/documents")
    assert r2.json()["total"] == 0

    async def _check():
        async with SessionLocal() as s:
            chunks = (
                await s.execute(select(KbChunk).where(KbChunk.document_id == doc_id))
            ).scalars().all()
            return len(chunks)

    assert asyncio.run(_check()) == 0


def test_delete_kb_document_404_for_missing(client_authed):
    r = client_authed.delete("/kb/documents/999999")
    assert r.status_code == 404
