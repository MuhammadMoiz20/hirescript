"""Lever source adapter unit tests.

Mirrors ``test_greenhouse_fetch.py`` shape — an ``httpx.MockTransport`` is
injected so no real network traffic happens. We assert normalization,
URL pattern matching, and that ``fetch_one_url`` hits the right URL.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.sources.lever import (
    LEVER_BASE_URL,
    LeverSource,
    lever_source,
)


_SAMPLE_PAYLOAD = [
    {
        "id": "abc-123",
        "text": "Senior Backend Engineer",
        "categories": {"location": "San Francisco", "team": "Eng"},
        "hostedUrl": "https://jobs.lever.co/netflix/abc-123",
        "applyUrl": "https://jobs.lever.co/netflix/abc-123/apply",
        "descriptionPlain": "Build great things.",
        "description": "<div><p>Build <b>great</b> things.</p></div>",
    },
    {
        "id": "def-456",
        "text": "Staff PM",
        "categories": {"location": "Remote"},
        "hostedUrl": "https://jobs.lever.co/netflix/def-456",
        "descriptionPlain": "Lead.",
        "description": "<p>Lead.</p>",
    },
]


def _make_client(
    *,
    status: int = 200,
    body: object | None = None,
    capture: list[httpx.Request] | None = None,
) -> httpx.AsyncClient:
    body_obj = body if body is not None else _SAMPLE_PAYLOAD

    def handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            capture.append(request)
        return httpx.Response(
            status,
            content=json.dumps(body_obj).encode("utf-8"),
            headers={"content-type": "application/json"},
        )

    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


@pytest.mark.asyncio
async def test_fetch_company_postings_normalizes_payload():
    captured: list[httpx.Request] = []
    async with _make_client(capture=captured) as http:
        out = await lever_source.fetch_company_postings("netflix", http=http)

    # Hits the v0 postings endpoint with mode=json
    assert captured[0].url.path == "/v0/postings/netflix"
    assert captured[0].url.params.get("mode") == "json"

    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "abc-123"
    assert first["title"] == "Senior Backend Engineer"
    assert first["location"] == "San Francisco"
    assert first["apply_url"] == "https://jobs.lever.co/netflix/abc-123"
    assert first["description_html"] is not None
    assert "<b>" not in first["description_text"]
    assert "great" in first["description_text"]
    assert first["meta"]["lever_id"] == "abc-123"
    assert first["meta"]["categories"] == {
        "location": "San Francisco",
        "team": "Eng",
    }


@pytest.mark.asyncio
async def test_fetch_returns_empty_on_404():
    async with _make_client(status=404, body={"error": "nope"}) as http:
        out = await lever_source.fetch_company_postings("nope", http=http)
    assert out == []


@pytest.mark.asyncio
async def test_fetch_raises_on_500():
    async with _make_client(status=500, body={"error": "boom"}) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await lever_source.fetch_company_postings("netflix", http=http)


def test_matches_url_recognizes_lever_url_families():
    s = LeverSource()
    assert s.matches_url("https://jobs.lever.co/netflix/abc-123")
    assert s.matches_url("https://jobs.lever.co/netflix/abc-123/")
    assert s.matches_url(
        "https://jobs.lever.co/netflix/abc-123/apply"
    )
    # lever.co/jobs/... (alt host pattern)
    assert s.matches_url("https://lever.co/jobs/netflix/abc-123")
    # Negatives
    assert not s.matches_url("https://boards.greenhouse.io/anthropic/jobs/1")
    assert not s.matches_url("https://example.com/x")
    assert not s.matches_url("not-a-url")


def test_slug_from_url_extracts_slug():
    s = LeverSource()
    assert s.slug_from_url("https://jobs.lever.co/netflix/abc-123") == "netflix"
    assert s.slug_from_url("https://lever.co/jobs/palantir/xyz") == "palantir"
    with pytest.raises(ValueError):
        s.slug_from_url("https://example.com/x")


@pytest.mark.asyncio
async def test_fetch_one_url_hits_per_posting_endpoint():
    captured: list[httpx.Request] = []
    async with _make_client(
        body=_SAMPLE_PAYLOAD[0], capture=captured
    ) as http:
        out = await lever_source.fetch_one_url(
            "https://jobs.lever.co/netflix/abc-123", http=http
        )

    assert captured[0].url.path == "/v0/postings/netflix/abc-123"
    assert captured[0].url.params.get("mode") == "json"
    assert out["source_job_id"] == "abc-123"
    assert out["title"] == "Senior Backend Engineer"


@pytest.mark.asyncio
async def test_fetch_one_url_rejects_non_lever_url():
    async with _make_client() as http:
        with pytest.raises(ValueError):
            await lever_source.fetch_one_url(
                "https://example.com/x", http=http
            )


def test_lever_base_url_constant():
    assert LEVER_BASE_URL == "https://api.lever.co/v0/postings"
