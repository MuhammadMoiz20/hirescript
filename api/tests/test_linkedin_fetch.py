"""LinkedIn source adapter tests.

LinkedIn requires JS rendering, so the adapter drives Playwright. We inject
a fake ``page_factory`` that yields a stub ``Page`` whose ``goto`` simply
loads HTML from a fixture file via ``set_content``. No real browser starts.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.sources import SOURCES
from app.services.sources.linkedin import LinkedInSource, linkedin_source
from app.services.sources.protocol import Source


FIXTURES = Path(__file__).parent / "fixtures"


class _FakePage:
    def __init__(self, html_by_url: dict[str, str]):
        self._html_by_url = html_by_url
        self._html = ""
        self.url = ""

    async def goto(self, url, **kwargs):
        self.url = url
        # Find best match (prefix match for /jobs/view/ ids).
        for key, html in self._html_by_url.items():
            if key in url:
                self._html = html
                return
        self._html = ""

    async def wait_for_selector(self, selector, **kwargs):
        return None

    async def evaluate(self, *args, **kwargs):
        # used for scroll loops — no-op
        return None

    async def mouse_wheel(self, *args, **kwargs):
        return None

    async def content(self):
        return self._html

    async def close(self):
        return None


class _FakeFactory:
    def __init__(self, html_by_url: dict[str, str]):
        self._html_by_url = html_by_url
        self.pages: list[_FakePage] = []

    async def __call__(self):
        page = _FakePage(self._html_by_url)
        self.pages.append(page)
        return page


def test_registered_with_high_tos_risk():
    assert "linkedin" in SOURCES
    assert SOURCES["linkedin"] is linkedin_source
    assert isinstance(linkedin_source, Source)
    assert linkedin_source.tos_risk == "high"
    assert linkedin_source.name == "linkedin"


@pytest.mark.asyncio
async def test_fetch_company_postings_parses_cards():
    html = (FIXTURES / "linkedin_company_jobs.html").read_text()
    factory = _FakeFactory({"/company/anthropic/jobs": html})
    out = await linkedin_source.fetch_company_postings(
        "anthropic", page_factory=factory
    )
    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "3851234567"
    assert first["title"] == "Senior Backend Engineer"
    assert first["location"] == "San Francisco, CA"
    assert "linkedin.com/jobs/view/3851234567" in first["apply_url"]


@pytest.mark.asyncio
async def test_fetch_one_url_parses_view_page():
    html = (FIXTURES / "linkedin_job_view.html").read_text()
    factory = _FakeFactory({"/jobs/view/3851234567": html})
    out = await linkedin_source.fetch_one_url(
        "https://www.linkedin.com/jobs/view/3851234567/",
        page_factory=factory,
    )
    assert out["source_job_id"] == "3851234567"
    assert out["title"] == "Senior Backend Engineer"
    assert out["location"] == "San Francisco, CA"
    assert "Build great" in out["description_text"]


def test_matches_url_recognizes_linkedin_jobs():
    s = LinkedInSource()
    assert s.matches_url("https://www.linkedin.com/jobs/view/3851234567/")
    assert s.matches_url("https://linkedin.com/jobs/view/3851234567")
    assert not s.matches_url("https://example.com/x")
    assert not s.matches_url("https://www.linkedin.com/in/someone")


def test_slug_from_url_uses_company_segment_when_present():
    s = LinkedInSource()
    # /company/{slug}/jobs/view/{id}
    assert (
        s.slug_from_url(
            "https://www.linkedin.com/company/anthropic/jobs/view/3851234567"
        )
        == "anthropic"
    )
    # /jobs/view/{id} → no slug derivable; raise.
    with pytest.raises(ValueError):
        s.slug_from_url("https://www.linkedin.com/jobs/view/3851234567")
