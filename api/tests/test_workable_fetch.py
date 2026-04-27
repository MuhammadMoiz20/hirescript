"""Workable source adapter unit tests."""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.sources.workable import (
    WORKABLE_LIST_URL,
    WORKABLE_DETAIL_URL,
    WorkableSource,
    workable_source,
)


_LIST_PAYLOAD = {
    "jobs": [
        {
            "id": 12345,
            "shortcode": "ABCD1234",
            "title": "Senior Engineer",
            "location": {"city": "San Francisco", "country": "USA"},
            "url": "https://apply.workable.com/miro/j/ABCD1234/",
        },
        {
            "id": 12346,
            "shortcode": "EFGH5678",
            "title": "Designer",
            "location": {"city": "Remote", "country": "USA"},
            "url": "https://apply.workable.com/miro/j/EFGH5678/",
        },
    ]
}


_DETAIL_PAYLOAD = {
    "id": 12345,
    "shortcode": "ABCD1234",
    "title": "Senior Engineer",
    "description": "<p>Build <b>great</b> things.</p>",
    "requirements": "<p>5y XP.</p>",
    "benefits": "<p>Health.</p>",
    "location": {"city": "San Francisco", "country": "USA"},
    "application_url": "https://apply.workable.com/miro/j/ABCD1234/apply/",
    "url": "https://apply.workable.com/miro/j/ABCD1234/",
    "department": "Engineering",
}


def _make_router_client(
    *,
    list_status: int = 200,
    list_body: dict | None = None,
    detail_status: int = 200,
    detail_body: dict | None = None,
    capture: list[httpx.Request] | None = None,
) -> httpx.AsyncClient:
    """Mock that branches on URL path: list vs per-job detail."""

    list_obj = list_body if list_body is not None else _LIST_PAYLOAD
    detail_obj = detail_body if detail_body is not None else _DETAIL_PAYLOAD

    def handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            capture.append(request)
        path = request.url.path
        if "/jobs/" in path:
            return httpx.Response(
                detail_status,
                content=json.dumps(detail_obj).encode("utf-8"),
                headers={"content-type": "application/json"},
            )
        return httpx.Response(
            list_status,
            content=json.dumps(list_obj).encode("utf-8"),
            headers={"content-type": "application/json"},
        )

    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


@pytest.mark.asyncio
async def test_fetch_company_postings_hits_list_endpoint_and_normalizes():
    captured: list[httpx.Request] = []
    async with _make_router_client(capture=captured) as http:
        out = await workable_source.fetch_company_postings("miro", http=http)

    # First call hits the v1 widget list.
    assert captured[0].url.path == "/api/v1/widget/accounts/miro"
    # Then one detail call per job.
    assert any(
        r.url.path == "/api/v3/accounts/miro/jobs/ABCD1234"
        for r in captured
    )
    assert any(
        r.url.path == "/api/v3/accounts/miro/jobs/EFGH5678"
        for r in captured
    )

    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "ABCD1234"
    assert first["title"] == "Senior Engineer"
    assert first["location"] is not None
    assert "San Francisco" in first["location"]
    assert first["apply_url"]
    assert "<b>" not in first["description_text"]
    assert "great" in first["description_text"]
    assert first["meta"]["workable_shortcode"] == "ABCD1234"


@pytest.mark.asyncio
async def test_fetch_returns_empty_on_404():
    async with _make_router_client(
        list_status=404, list_body={"error": "nope"}
    ) as http:
        out = await workable_source.fetch_company_postings("nope", http=http)
    assert out == []


def test_matches_url_recognizes_workable_url():
    s = WorkableSource()
    assert s.matches_url("https://apply.workable.com/miro/j/ABCD1234/")
    assert s.matches_url("https://apply.workable.com/miro/j/ABCD1234")
    assert not s.matches_url("https://jobs.lever.co/x/y")
    assert not s.matches_url("not-a-url")


def test_slug_from_url_extracts_slug():
    s = WorkableSource()
    assert (
        s.slug_from_url(
            "https://apply.workable.com/miro/j/ABCD1234/"
        )
        == "miro"
    )
    with pytest.raises(ValueError):
        s.slug_from_url("https://example.com/x")


@pytest.mark.asyncio
async def test_fetch_one_url_hits_v3_detail_endpoint():
    captured: list[httpx.Request] = []
    async with _make_router_client(capture=captured) as http:
        out = await workable_source.fetch_one_url(
            "https://apply.workable.com/miro/j/ABCD1234/", http=http
        )

    assert captured[0].url.path == "/api/v3/accounts/miro/jobs/ABCD1234"
    assert out["source_job_id"] == "ABCD1234"
    assert out["title"] == "Senior Engineer"


@pytest.mark.asyncio
async def test_fetch_one_url_rejects_non_workable_url():
    async with _make_router_client() as http:
        with pytest.raises(ValueError):
            await workable_source.fetch_one_url(
                "https://example.com/x", http=http
            )


def test_workable_url_constants():
    assert "apply.workable.com" in WORKABLE_LIST_URL
    assert "apply.workable.com" in WORKABLE_DETAIL_URL
