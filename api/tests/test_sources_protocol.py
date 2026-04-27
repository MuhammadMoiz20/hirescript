"""Tests for the :class:`Source` protocol + Greenhouse implementation.

Covers registry membership, URL pattern matching, ``slug_from_url``,
``fetch_company_postings`` (mocked httpx), and ``fetch_one_url`` (mocked
httpx — asserts both the request URL and the normalized payload).
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.sources import SOURCES
from app.services.sources.protocol import CoverLetterRequirement
from app.services.sources.greenhouse import greenhouse_source
from app.services.sources.protocol import Source


# --- Registry ---------------------------------------------------------------


def test_registry_contains_greenhouse():
    assert "greenhouse" in SOURCES
    assert SOURCES["greenhouse"] is greenhouse_source


def test_greenhouse_satisfies_source_protocol():
    assert isinstance(greenhouse_source, Source)
    assert greenhouse_source.name == "greenhouse"


# --- matches_url ------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://boards.greenhouse.io/anthropic/jobs/4567",
        "https://boards.greenhouse.io/anthropic/jobs/4567/",
        "https://job-boards.greenhouse.io/anthropic/jobs/4567",
        "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs/4567",
        "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs/4567?content=true",
    ],
)
def test_matches_url_accepts_greenhouse_families(url):
    assert greenhouse_source.matches_url(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "https://jobs.lever.co/netflix/abc",
        "https://jobs.ashbyhq.com/notion/xyz",
        "https://example.com/jobs/4567",
        "https://boards.greenhouse.io/",  # missing slug + id
        "https://boards.greenhouse.io/anthropic/jobs/",  # missing id
        "https://boards.greenhouse.io/anthropic/jobs/notanumber",
        "not a url at all",
    ],
)
def test_matches_url_rejects_non_greenhouse(url):
    assert greenhouse_source.matches_url(url) is False


# --- slug_from_url ----------------------------------------------------------


@pytest.mark.parametrize(
    "url, slug",
    [
        ("https://boards.greenhouse.io/anthropic/jobs/4567", "anthropic"),
        ("https://job-boards.greenhouse.io/openai/jobs/1", "openai"),
        (
            "https://boards-api.greenhouse.io/v1/boards/stripe/jobs/9",
            "stripe",
        ),
    ],
)
def test_slug_from_url_extracts_slug(url, slug):
    assert greenhouse_source.slug_from_url(url) == slug


def test_slug_from_url_raises_on_mismatch():
    with pytest.raises(ValueError):
        greenhouse_source.slug_from_url("https://example.com/jobs/1")


# --- fetch_company_postings -------------------------------------------------


_BOARD_PAYLOAD = {
    "jobs": [
        {
            "id": 1,
            "title": "Engineer",
            "absolute_url": "https://boards.greenhouse.io/anthropic/jobs/1",
            "location": {"name": "Remote"},
            "content": "<p>build</p>",
            "departments": [{"name": "Eng"}],
            "offices": [{"name": "Remote"}],
        },
    ]
}


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_fetch_company_postings_returns_normalized_shape():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(
            200,
            content=json.dumps(_BOARD_PAYLOAD).encode(),
            headers={"content-type": "application/json"},
        )

    async with _client(handler) as http:
        out = await greenhouse_source.fetch_company_postings(
            "anthropic", http=http
        )

    # Hit the board endpoint, not a single-job endpoint.
    assert "/v1/boards/anthropic/jobs" in seen["url"]
    assert len(out) == 1
    posting = out[0]
    # Normalized shape — keys present, types correct.
    for key in (
        "source_job_id",
        "title",
        "location",
        "apply_url",
        "description_html",
        "description_text",
        "meta",
    ):
        assert key in posting
    assert posting["source_job_id"] == "1"
    assert posting["title"] == "Engineer"
    assert posting["location"] == "Remote"
    assert posting["apply_url"].endswith("/1")
    assert "build" in posting["description_text"]


# --- fetch_one_url ----------------------------------------------------------


_ONE_JOB_PAYLOAD = {
    "id": 4567,
    "title": "Senior Engineer",
    "absolute_url": "https://boards.greenhouse.io/anthropic/jobs/4567",
    "location": {"name": "SF"},
    "content": "<p>do work</p>",
    "departments": [{"name": "Eng"}],
    "offices": [{"name": "SF"}],
}


@pytest.mark.asyncio
async def test_fetch_one_url_hits_single_job_endpoint_and_normalizes():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(
            200,
            content=json.dumps(_ONE_JOB_PAYLOAD).encode(),
            headers={"content-type": "application/json"},
        )

    async with _client(handler) as http:
        posting = await greenhouse_source.fetch_one_url(
            "https://boards.greenhouse.io/anthropic/jobs/4567",
            http=http,
        )

    assert "/v1/boards/anthropic/jobs/4567" in seen["url"]
    assert "content=true" in seen["url"]
    assert posting["source_job_id"] == "4567"
    assert posting["title"] == "Senior Engineer"
    assert posting["location"] == "SF"


@pytest.mark.asyncio
async def test_fetch_one_url_raises_on_non_greenhouse_url():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("HTTP must not be called for an unrecognized URL")

    async with _client(handler) as http:
        with pytest.raises(ValueError):
            await greenhouse_source.fetch_one_url(
                "https://example.com/jobs/1", http=http
            )


# --- CoverLetterRequirement -------------------------------------------------


def test_cover_letter_requirement_should_generate():
    assert CoverLetterRequirement.REQUIRED.should_generate()
    assert CoverLetterRequirement.OPTIONAL.should_generate()
    assert CoverLetterRequirement.UNKNOWN.should_generate()
    assert not CoverLetterRequirement.NOT_PRESENT.should_generate()
