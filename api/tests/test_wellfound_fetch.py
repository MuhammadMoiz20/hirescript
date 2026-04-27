"""Wellfound source adapter tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.sources import SOURCES
from app.services.sources.protocol import Source
from app.services.sources.wellfound import WellfoundSource, wellfound_source


FIXTURES = Path(__file__).parent / "fixtures"


class _FakePage:
    def __init__(self, html_by_url):
        self._h = html_by_url
        self._html = ""
        self.url = ""

    async def goto(self, url, **kw):
        self.url = url
        for k, html in self._h.items():
            if k in url:
                self._html = html
                return
        self._html = ""

    async def wait_for_selector(self, *a, **kw):
        return None

    async def evaluate(self, *a, **kw):
        return None

    async def content(self):
        return self._html

    async def close(self):
        return None


def _factory(h):
    async def f():
        return _FakePage(h)
    return f


def test_registered_high_tos_risk():
    assert "wellfound" in SOURCES
    assert SOURCES["wellfound"] is wellfound_source
    assert isinstance(wellfound_source, Source)
    assert wellfound_source.tos_risk == "high"
    assert wellfound_source.name == "wellfound"


@pytest.mark.asyncio
async def test_fetch_company_postings_parses_cards():
    html = (FIXTURES / "wellfound_company_jobs.html").read_text()
    out = await wellfound_source.fetch_company_postings(
        "anthropic", page_factory=_factory({"/company/anthropic/jobs": html})
    )
    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "12345"
    assert first["title"] == "Senior Backend Engineer"
    assert first["location"] == "San Francisco, CA"
    assert "/jobs/12345" in first["apply_url"]


@pytest.mark.asyncio
async def test_fetch_one_url_parses_view_page():
    html = (FIXTURES / "wellfound_job_view.html").read_text()
    url = "https://wellfound.com/jobs/12345-senior-backend-engineer"
    out = await wellfound_source.fetch_one_url(
        url, page_factory=_factory({"/jobs/12345": html})
    )
    assert out["source_job_id"] == "12345"
    assert out["title"] == "Senior Backend Engineer"
    assert out["location"] == "San Francisco, CA"
    assert "Build great" in out["description_text"]


def test_matches_url_recognizes_wellfound():
    s = WellfoundSource()
    assert s.matches_url("https://wellfound.com/jobs/12345-senior-eng")
    assert s.matches_url("https://www.wellfound.com/jobs/12345")
    assert not s.matches_url("https://example.com/x")


def test_slug_from_url_extracts_company():
    s = WellfoundSource()
    assert (
        s.slug_from_url("https://wellfound.com/company/anthropic/jobs")
        == "anthropic"
    )
    with pytest.raises(ValueError):
        s.slug_from_url("https://wellfound.com/jobs/12345")
