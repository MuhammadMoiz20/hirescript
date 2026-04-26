"""Greenhouse fetch + normalize + upsert unit tests.

We never call out to the network — ``fetch_company_jobs`` takes an
``httpx.AsyncClient`` so tests inject a stub via ``httpx.MockTransport``.
"""

from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select

from app.models import Company, JobPosting, User
from app.services.sources.greenhouse import (
    NormalizedPosting,
    fetch_company_jobs,
    upsert_postings,
)


_SAMPLE_PAYLOAD = {
    "jobs": [
        {
            "id": 4567,
            "title": "Senior Engineer",
            "absolute_url": "https://boards.greenhouse.io/anthropic/jobs/4567",
            "location": {"name": "Remote – US"},
            "content": "<div><p>Build <b>great</b> things.</p>&lt;ok&gt;</div>",
            "departments": [{"name": "Engineering"}],
            "offices": [{"name": "Remote"}],
        },
        {
            "id": 4568,
            "title": "Staff Researcher",
            "absolute_url": "https://boards.greenhouse.io/anthropic/jobs/4568",
            "location": {"name": "San Francisco"},
            "content": "<p>Research role.</p>",
            "departments": [{"name": "Research"}],
            "offices": [{"name": "SF"}],
        },
    ]
}


def _make_client(
    *, status: int = 200, body: dict | None = None
) -> httpx.AsyncClient:
    body_obj = body if body is not None else _SAMPLE_PAYLOAD

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            content=json.dumps(body_obj).encode("utf-8"),
            headers={"content-type": "application/json"},
        )

    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


@pytest.mark.asyncio
async def test_fetch_normalizes_payload():
    async with _make_client() as http:
        out = await fetch_company_jobs("anthropic", http=http)

    assert len(out) == 2
    first = out[0]
    assert first["source_job_id"] == "4567"
    assert first["title"] == "Senior Engineer"
    assert first["location"] == "Remote – US"
    assert first["apply_url"].endswith("/4567")
    assert first["description_html"] is not None
    # Real HTML tags stripped; entity-encoded literals preserved as text.
    assert "<div>" not in first["description_text"]
    assert "<b>" not in first["description_text"]
    assert "great" in first["description_text"]
    assert "<ok>" in first["description_text"]
    assert first["meta"]["greenhouse_id"] == 4567
    assert first["meta"]["departments"] == ["Engineering"]
    assert first["meta"]["offices"] == ["Remote"]


@pytest.mark.asyncio
async def test_fetch_returns_empty_on_404():
    async with _make_client(status=404, body={"error": "not found"}) as http:
        out = await fetch_company_jobs("nonexistent", http=http)
    assert out == []


@pytest.mark.asyncio
async def test_fetch_raises_on_other_http_errors():
    async with _make_client(status=500, body={"error": "boom"}) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await fetch_company_jobs("anthropic", http=http)


def _posting(
    source_job_id: str,
    *,
    title: str = "Engineer",
    location: str | None = "Remote",
    apply_url: str = "https://example.com/jobs/1",
    description_text: str = "build stuff",
) -> NormalizedPosting:
    return NormalizedPosting(
        source_job_id=source_job_id,
        title=title,
        location=location,
        apply_url=apply_url,
        description_html=f"<p>{description_text}</p>",
        description_text=description_text,
        meta={"greenhouse_id": int(source_job_id)},
    )


async def _ensure_user(db_session) -> None:
    existing = (
        await db_session.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db_session.add(User(id=1))
        await db_session.commit()


@pytest.mark.asyncio
async def test_upsert_creates_new_postings(db_session):
    await _ensure_user(db_session)
    company = Company(slug="anthropic", display_name="Anthropic", source="greenhouse")
    db_session.add(company)
    await db_session.commit()
    await db_session.refresh(company)

    counts = await upsert_postings(
        db_session,
        user_id=1,
        company_id=company.id,
        source="greenhouse",
        postings=[_posting("1"), _posting("2"), _posting("3")],
    )
    assert counts == {"created": 3, "updated": 0, "unchanged": 0}

    rows = (await db_session.execute(select(JobPosting))).scalars().all()
    assert len(rows) == 3
    assert {r.source_job_id for r in rows} == {"1", "2", "3"}
    assert all(r.company_id == company.id for r in rows)


@pytest.mark.asyncio
async def test_upsert_unchanged_returns_zero_writes(db_session):
    await _ensure_user(db_session)
    company = Company(slug="anthropic", display_name="Anthropic", source="greenhouse")
    db_session.add(company)
    await db_session.commit()
    await db_session.refresh(company)

    p = _posting("42", title="Engineer", description_text="hello")
    await upsert_postings(
        db_session,
        user_id=1,
        company_id=company.id,
        source="greenhouse",
        postings=[p],
    )

    counts = await upsert_postings(
        db_session,
        user_id=1,
        company_id=company.id,
        source="greenhouse",
        postings=[p],
    )
    assert counts == {"created": 0, "updated": 0, "unchanged": 1}


@pytest.mark.asyncio
async def test_upsert_updates_changed_postings(db_session):
    await _ensure_user(db_session)
    company = Company(slug="anthropic", display_name="Anthropic", source="greenhouse")
    db_session.add(company)
    await db_session.commit()
    await db_session.refresh(company)

    await upsert_postings(
        db_session,
        user_id=1,
        company_id=company.id,
        source="greenhouse",
        postings=[_posting("99", title="Old", description_text="old desc")],
    )

    counts = await upsert_postings(
        db_session,
        user_id=1,
        company_id=company.id,
        source="greenhouse",
        postings=[_posting("99", title="New", description_text="new desc")],
    )
    assert counts == {"created": 0, "updated": 1, "unchanged": 0}

    row = (
        await db_session.execute(
            select(JobPosting).where(JobPosting.source_job_id == "99")
        )
    ).scalar_one()
    assert row.title == "New"
    assert row.description_text == "new desc"
