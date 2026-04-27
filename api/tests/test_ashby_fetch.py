"""Ashby source adapter unit tests."""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.sources.ashby import (
    ASHBY_BASE_URL,
    AshbySource,
    ashby_source,
)


_SAMPLE_PAYLOAD = {
    "jobs": [
        {
            "id": "11111111-2222-3333-4444-555555555555",
            "title": "Senior Engineer",
            "location": "Remote",
            "jobUrl": (
                "https://jobs.ashbyhq.com/notion/"
                "11111111-2222-3333-4444-555555555555"
            ),
            "descriptionHtml": "<p>Build <b>great</b> things.</p>",
            "descriptionPlain": "Build great things.",
            "department": "Engineering",
            "team": "Platform",
        },
        {
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "title": "Designer",
            "location": "NYC",
            "jobUrl": (
                "https://jobs.ashbyhq.com/notion/"
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            ),
            "descriptionHtml": "<p>Design.</p>",
            "descriptionPlain": "Design.",
        },
    ]
}


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
        out = await ashby_source.fetch_company_postings("notion", http=http)

    assert captured[0].url.path == "/posting-api/job-board/notion"
    assert captured[0].url.params.get("includeCompensation") == "true"

    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "11111111-2222-3333-4444-555555555555"
    assert first["title"] == "Senior Engineer"
    assert first["location"] == "Remote"
    assert first["apply_url"].endswith(
        "11111111-2222-3333-4444-555555555555"
    )
    assert "<b>" not in first["description_text"]
    assert "great" in first["description_text"]
    assert first["meta"]["ashby_id"] == (
        "11111111-2222-3333-4444-555555555555"
    )


@pytest.mark.asyncio
async def test_fetch_returns_empty_on_404():
    async with _make_client(status=404, body={"error": "nope"}) as http:
        out = await ashby_source.fetch_company_postings("nope", http=http)
    assert out == []


def test_matches_url_recognizes_ashby_url_families():
    s = AshbySource()
    assert s.matches_url(
        "https://jobs.ashbyhq.com/notion/"
        "11111111-2222-3333-4444-555555555555"
    )
    assert s.matches_url("https://jobs.ashbyhq.com/notion/short-id-123")
    assert not s.matches_url("https://jobs.lever.co/x/y")
    assert not s.matches_url("not-a-url")


def test_slug_from_url_extracts_slug():
    s = AshbySource()
    assert (
        s.slug_from_url(
            "https://jobs.ashbyhq.com/notion/"
            "11111111-2222-3333-4444-555555555555"
        )
        == "notion"
    )
    with pytest.raises(ValueError):
        s.slug_from_url("https://example.com/x")


@pytest.mark.asyncio
async def test_fetch_one_url_finds_matching_id_in_board():
    """Ashby posting-api is board-scoped, so fetch_one_url must walk the board."""
    captured: list[httpx.Request] = []
    async with _make_client(capture=captured) as http:
        out = await ashby_source.fetch_one_url(
            "https://jobs.ashbyhq.com/notion/"
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            http=http,
        )

    # Hits the board endpoint (slug-only).
    assert captured[0].url.path == "/posting-api/job-board/notion"
    assert out["source_job_id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert out["title"] == "Designer"


@pytest.mark.asyncio
async def test_fetch_one_url_raises_when_id_missing_from_board():
    async with _make_client() as http:
        with pytest.raises(ValueError):
            await ashby_source.fetch_one_url(
                "https://jobs.ashbyhq.com/notion/missing-id-not-in-board",
                http=http,
            )


@pytest.mark.asyncio
async def test_fetch_one_url_rejects_non_ashby_url():
    async with _make_client() as http:
        with pytest.raises(ValueError):
            await ashby_source.fetch_one_url(
                "https://example.com/x", http=http
            )


def test_ashby_base_url_constant():
    assert ASHBY_BASE_URL == "https://api.ashbyhq.com/posting-api/job-board"
