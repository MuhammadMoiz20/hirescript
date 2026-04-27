"""Indeed source adapter tests — same shape as ``test_linkedin_fetch.py``."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.sources import SOURCES
from app.services.sources.indeed import IndeedSource, indeed_source
from app.services.sources.protocol import Source


FIXTURES = Path(__file__).parent / "fixtures"


class _FakePage:
    def __init__(self, html_by_url):
        self._html_by_url = html_by_url
        self._html = ""
        self.url = ""

    async def goto(self, url, **kw):
        self.url = url
        for k, html in self._html_by_url.items():
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


def _factory(html_by_url):
    async def f():
        return _FakePage(html_by_url)
    return f


def test_registered_high_tos_risk():
    assert "indeed" in SOURCES
    assert SOURCES["indeed"] is indeed_source
    assert isinstance(indeed_source, Source)
    assert indeed_source.tos_risk == "high"
    assert indeed_source.name == "indeed"


@pytest.mark.asyncio
async def test_fetch_company_postings_parses_cards():
    html = (FIXTURES / "indeed_company_jobs.html").read_text()
    out = await indeed_source.fetch_company_postings(
        "anthropic", page_factory=_factory({"/cmp/anthropic/jobs": html})
    )
    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "abc123def456"
    assert first["title"] == "Senior Backend Engineer"
    assert first["location"] == "San Francisco, CA"
    assert "viewjob?jk=abc123def456" in first["apply_url"]


@pytest.mark.asyncio
async def test_fetch_one_url_parses_view_page():
    html = (FIXTURES / "indeed_job_view.html").read_text()
    url = "https://www.indeed.com/viewjob?jk=abc123def456"
    out = await indeed_source.fetch_one_url(
        url, page_factory=_factory({"jk=abc123def456": html})
    )
    assert out["source_job_id"] == "abc123def456"
    assert out["title"] == "Senior Backend Engineer"
    assert out["location"] == "San Francisco, CA"
    assert "Build great" in out["description_text"]


def test_matches_url_recognizes_indeed():
    s = IndeedSource()
    assert s.matches_url("https://www.indeed.com/viewjob?jk=abc")
    assert s.matches_url("https://indeed.com/viewjob?jk=abc")
    assert not s.matches_url("https://www.indeed.com/")
    assert not s.matches_url("https://example.com/x")


def test_slug_from_url_from_company_path():
    s = IndeedSource()
    assert (
        s.slug_from_url("https://www.indeed.com/cmp/anthropic/jobs")
        == "anthropic"
    )
    with pytest.raises(ValueError):
        s.slug_from_url("https://www.indeed.com/viewjob?jk=abc")
