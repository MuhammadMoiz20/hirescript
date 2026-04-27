"""Tests for the Notion KB sync adapter (slice 5 task 13)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import KbChunk, KbDocument
from app.services import kb_ingest
from app.services.kb_sources import notion as notion_kb


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


class _FakeNotion:
    """Minimal stand-in for the Notion client."""

    def __init__(
        self,
        *,
        pages: dict[str, dict[str, Any]],
        blocks: dict[str, list[dict[str, Any]]],
    ) -> None:
        self.pages = pages
        self.blocks = blocks
        self.calls: list[tuple[str, str]] = []

    async def fetch_page(self, page_id: str) -> dict[str, Any]:
        self.calls.append(("page", page_id))
        return self.pages[page_id]

    async def fetch_blocks(self, page_id: str) -> list[dict[str, Any]]:
        self.calls.append(("blocks", page_id))
        return list(self.blocks.get(page_id, []))


def _para(text: str) -> dict[str, Any]:
    return {
        "type": "paragraph",
        "paragraph": {
            "rich_text": [{"plain_text": text}],
        },
    }


def _heading(text: str, level: int = 1) -> dict[str, Any]:
    key = f"heading_{level}"
    return {
        "type": key,
        key: {"rich_text": [{"plain_text": text}]},
    }


async def test_notion_sync_ingests_two_pages(monkeypatch):
    _stub_embed(monkeypatch)
    fake = _FakeNotion(
        pages={
            "page-a": {
                "id": "page-a",
                "properties": {"title": {"title": [{"plain_text": "Career Notes"}]}},
            },
            "page-b": {
                "id": "page-b",
                "properties": {"title": {"title": [{"plain_text": "Mission"}]}},
            },
        },
        blocks={
            "page-a": [_heading("Career Notes"), _para("I shipped foo at bar.")],
            "page-b": [_heading("Mission"), _para("Build durable tools.")],
        },
    )

    async with SessionLocal() as s:
        out = await notion_kb.ingest(
            user_id=1, db=s, page_ids=["page-a", "page-b"], client=fake
        )
    assert out["created_or_updated"] == 2
    assert out["deleted"] == 0

    async with SessionLocal() as s:
        docs = (
            await s.execute(
                select(KbDocument).where(KbDocument.source == "notion")
            )
        ).scalars().all()
    assert {d.source_id for d in docs} == {"page-a", "page-b"}
    assert {d.title for d in docs} == {"Career Notes", "Mission"}


async def test_notion_sync_deletes_removed_pages(monkeypatch):
    _stub_embed(monkeypatch)
    fake = _FakeNotion(
        pages={
            "page-a": {
                "id": "page-a",
                "properties": {"title": {"title": [{"plain_text": "Alpha"}]}},
            },
            "page-b": {
                "id": "page-b",
                "properties": {"title": {"title": [{"plain_text": "Bravo"}]}},
            },
        },
        blocks={
            "page-a": [_para("alpha body")],
            "page-b": [_para("bravo body")],
        },
    )

    async with SessionLocal() as s:
        await notion_kb.ingest(
            user_id=1, db=s, page_ids=["page-a", "page-b"], client=fake
        )

    # Drop page-b from the configured set; ingest should purge it.
    async with SessionLocal() as s:
        out = await notion_kb.ingest(
            user_id=1, db=s, page_ids=["page-a"], client=fake
        )
    assert out["deleted"] == 1

    async with SessionLocal() as s:
        docs = (
            await s.execute(
                select(KbDocument).where(KbDocument.source == "notion")
            )
        ).scalars().all()
    assert [d.source_id for d in docs] == ["page-a"]


async def test_notion_sync_no_token_returns_zero(monkeypatch):
    _stub_embed(monkeypatch)
    async with SessionLocal() as s:
        out = await notion_kb.ingest(user_id=1, db=s, page_ids=[], client=None)
    assert out == {"created_or_updated": 0, "deleted": 0}
