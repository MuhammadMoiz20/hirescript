"""Tests for the personal-website KB crawler (slice 5 task 14)."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import KbChunk, KbDocument
from app.services import kb_ingest
from app.services.kb_sources import website as website_kb


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


class _FakeFetcher:
    """Tiny URL->(status, content_type, body) map; tracks fetched URLs."""

    def __init__(self, pages: dict[str, tuple[int, str, str]]) -> None:
        self.pages = pages
        self.fetched: list[str] = []

    async def get(self, url: str) -> tuple[int, str, str]:
        self.fetched.append(url)
        return self.pages.get(url, (404, "text/plain", ""))


_ROBOTS_ALLOW_ALL = "User-agent: *\nAllow: /\n"
_ROBOTS_DENY_PRIVATE = "User-agent: *\nDisallow: /private\n"


def _html(title: str, body: str, links: list[str] | None = None) -> str:
    link_html = "".join(f'<a href="{h}">x</a>' for h in (links or []))
    return f"<html><head><title>{title}</title></head><body>{body}{link_html}</body></html>"


async def test_website_sync_crawls_two_pages(monkeypatch):
    _stub_embed(monkeypatch)
    fetcher = _FakeFetcher(
        {
            "https://example.com/robots.txt": (200, "text/plain", _ROBOTS_ALLOW_ALL),
            "https://example.com/": (
                200,
                "text/html",
                _html("Home", "<p>welcome</p>", ["/about"]),
            ),
            "https://example.com/about": (
                200,
                "text/html",
                _html("About", "<p>about me</p>"),
            ),
        }
    )

    async with SessionLocal() as s:
        out = await website_kb.ingest(
            user_id=1,
            db=s,
            root_url="https://example.com/",
            fetcher=fetcher,
            max_pages=10,
        )
    assert out["created_or_updated"] == 2
    assert out["deleted"] == 0

    async with SessionLocal() as s:
        docs = (
            await s.execute(
                select(KbDocument).where(KbDocument.source == "website")
            )
        ).scalars().all()
    urls = {d.source_id for d in docs}
    assert "https://example.com/" in urls
    assert "https://example.com/about" in urls


async def test_website_sync_honours_robots_deny(monkeypatch):
    _stub_embed(monkeypatch)
    fetcher = _FakeFetcher(
        {
            "https://example.com/robots.txt": (200, "text/plain", _ROBOTS_DENY_PRIVATE),
            "https://example.com/": (
                200,
                "text/html",
                _html("Home", "<p>welcome</p>", ["/private/secret", "/about"]),
            ),
            "https://example.com/about": (
                200,
                "text/html",
                _html("About", "<p>about me</p>"),
            ),
            "https://example.com/private/secret": (
                200,
                "text/html",
                _html("Secret", "<p>nope</p>"),
            ),
        }
    )

    async with SessionLocal() as s:
        out = await website_kb.ingest(
            user_id=1,
            db=s,
            root_url="https://example.com/",
            fetcher=fetcher,
            max_pages=10,
        )

    async with SessionLocal() as s:
        docs = (
            await s.execute(
                select(KbDocument).where(KbDocument.source == "website")
            )
        ).scalars().all()
    urls = {d.source_id for d in docs}
    assert "https://example.com/private/secret" not in urls
    assert "https://example.com/about" in urls
    assert out["created_or_updated"] == 2  # home + about


async def test_website_sync_deny_pattern_excludes(monkeypatch):
    _stub_embed(monkeypatch)
    fetcher = _FakeFetcher(
        {
            "https://example.com/robots.txt": (200, "text/plain", _ROBOTS_ALLOW_ALL),
            "https://example.com/": (
                200,
                "text/html",
                _html("Home", "<p>welcome</p>", ["/blog/keep", "/drafts/skip"]),
            ),
            "https://example.com/blog/keep": (
                200,
                "text/html",
                _html("Keep", "<p>k</p>"),
            ),
            "https://example.com/drafts/skip": (
                200,
                "text/html",
                _html("Skip", "<p>s</p>"),
            ),
        }
    )

    async with SessionLocal() as s:
        out = await website_kb.ingest(
            user_id=1,
            db=s,
            root_url="https://example.com/",
            fetcher=fetcher,
            deny_patterns=["/drafts/"],
            max_pages=10,
        )
    assert out["created_or_updated"] == 2

    async with SessionLocal() as s:
        urls = {
            d.source_id
            for d in (
                await s.execute(
                    select(KbDocument).where(KbDocument.source == "website")
                )
            ).scalars().all()
        }
    assert urls == {"https://example.com/", "https://example.com/blog/keep"}


async def test_website_sync_purges_removed_pages(monkeypatch):
    _stub_embed(monkeypatch)
    fetcher = _FakeFetcher(
        {
            "https://example.com/robots.txt": (200, "text/plain", _ROBOTS_ALLOW_ALL),
            "https://example.com/": (
                200,
                "text/html",
                _html("Home", "<p>w</p>", ["/about", "/old"]),
            ),
            "https://example.com/about": (
                200,
                "text/html",
                _html("About", "<p>a</p>"),
            ),
            "https://example.com/old": (
                200,
                "text/html",
                _html("Old", "<p>o</p>"),
            ),
        }
    )
    async with SessionLocal() as s:
        await website_kb.ingest(
            user_id=1,
            db=s,
            root_url="https://example.com/",
            fetcher=fetcher,
            max_pages=10,
        )

    # Now /old is gone (404).
    fetcher.pages["https://example.com/old"] = (404, "text/plain", "")
    fetcher.pages["https://example.com/"] = (
        200,
        "text/html",
        _html("Home", "<p>w</p>", ["/about"]),
    )
    async with SessionLocal() as s:
        out = await website_kb.ingest(
            user_id=1,
            db=s,
            root_url="https://example.com/",
            fetcher=fetcher,
            max_pages=10,
        )
    assert out["deleted"] == 1

    async with SessionLocal() as s:
        urls = {
            d.source_id
            for d in (
                await s.execute(
                    select(KbDocument).where(KbDocument.source == "website")
                )
            ).scalars().all()
        }
    assert urls == {"https://example.com/", "https://example.com/about"}
