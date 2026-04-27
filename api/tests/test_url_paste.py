"""Tests for ``POST /postings/from_url``.

The route synchronously dispatches a pasted job URL to the matching
source adapter, upserts the resulting ``NormalizedPosting``, makes sure
a ``Company`` row exists for ``(source, slug)`` (creating one with a
title-cased default display name if not), and enqueues a
``classify_posting`` job for newly-created rows.

Adapters are stubbed via ``monkeypatch.setattr`` on the
:data:`SOURCES`-registered instance so no real network traffic occurs.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.main import app
from app.models import Company, Job, JobPosting
from app.services.sources import SOURCES

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_db():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(
                delete(Job).where(Job.kind == "classify_posting")
            )
            await s.execute(
                delete(JobPosting).where(JobPosting.user_id == 1)
            )
            await s.execute(delete(Company))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    return client.post(
        "/auth/login", json={"password": "changeme"}
    ).cookies


def _posting(source_job_id: str = "1") -> dict:
    return {
        "source_job_id": source_job_id,
        "title": "Backend Engineer",
        "location": "Remote",
        "apply_url": f"https://example.test/jobs/{source_job_id}",
        "description_html": "<p>desc</p>",
        "description_text": "desc",
        "meta": {},
    }


def _stub(monkeypatch, *, source: str, posting: dict):
    async def _fake_one(url, *, http):
        return posting

    monkeypatch.setattr(SOURCES[source], "fetch_one_url", _fake_one)


# --- Auth gate --------------------------------------------------------------


def test_from_url_requires_auth():
    r = client.post(
        "/postings/from_url",
        json={"url": "https://boards.greenhouse.io/anthropic/jobs/1"},
    )
    assert r.status_code == 401


# --- Unrecognized URL → 422 -------------------------------------------------


def test_from_url_rejects_unrecognized_url():
    cookies = _login()
    r = client.post(
        "/postings/from_url",
        json={"url": "https://example.com/some/random/url"},
        cookies=cookies,
    )
    assert r.status_code == 422
    assert "URL not recognized" in r.json()["detail"]
    assert "greenhouse" in r.json()["detail"]


# --- Per-source happy paths -------------------------------------------------


_URL_BY_SOURCE = {
    "greenhouse": "https://boards.greenhouse.io/anthropic/jobs/123",
    "lever": "https://jobs.lever.co/netflix/abc123",
    "ashby": "https://jobs.ashbyhq.com/notion/some-job-id",
    "workable": "https://apply.workable.com/miro/j/ABCDEF1234/",
}


@pytest.mark.parametrize("source", list(_URL_BY_SOURCE.keys()))
def test_from_url_creates_posting_and_company_and_enqueues_classify(
    monkeypatch, source
):
    cookies = _login()
    _stub(monkeypatch, source=source, posting=_posting("999"))

    r = client.post(
        "/postings/from_url",
        json={"url": _URL_BY_SOURCE[source]},
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == source
    assert body["source_job_id"] == "999"
    assert body["title"] == "Backend Engineer"
    assert body["status"] == "new"

    # Company upserted with title-cased slug as display_name.
    expected_slug = SOURCES[source].slug_from_url(_URL_BY_SOURCE[source])

    async def _check():
        async with SessionLocal() as s:
            companies = (
                await s.execute(
                    select(Company).where(Company.source == source)
                )
            ).scalars().all()
            postings = (
                await s.execute(select(JobPosting))
            ).scalars().all()
            classify_jobs = (
                await s.execute(
                    select(Job).where(Job.kind == "classify_posting")
                )
            ).scalars().all()
            return companies, postings, classify_jobs

    companies, postings, classify_jobs = asyncio.run(_check())
    assert len(companies) == 1
    assert companies[0].slug == expected_slug
    assert companies[0].display_name == expected_slug.title()
    assert len(postings) == 1
    assert postings[0].company_id == companies[0].id
    assert len(classify_jobs) == 1
    assert (classify_jobs[0].payload or {})["posting_id"] == postings[0].id


# --- Duplicate URL → 200, no extra classify --------------------------------


def test_from_url_duplicate_returns_existing_no_extra_classify(monkeypatch):
    cookies = _login()
    _stub(monkeypatch, source="greenhouse", posting=_posting("777"))

    url = "https://boards.greenhouse.io/anthropic/jobs/777"
    r1 = client.post(
        "/postings/from_url", json={"url": url}, cookies=cookies
    )
    assert r1.status_code == 201

    r2 = client.post(
        "/postings/from_url", json={"url": url}, cookies=cookies
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"]

    async def _check():
        async with SessionLocal() as s:
            postings = (
                await s.execute(select(JobPosting))
            ).scalars().all()
            classify_jobs = (
                await s.execute(
                    select(Job).where(Job.kind == "classify_posting")
                )
            ).scalars().all()
            return postings, classify_jobs

    postings, classify_jobs = asyncio.run(_check())
    assert len(postings) == 1
    # Only the first call enqueued a classify job.
    assert len(classify_jobs) == 1


# --- Adapter raises ValueError on a recognized-but-malformed URL → 422 -----


def test_from_url_adapter_value_error_returns_422(monkeypatch):
    cookies = _login()

    async def _boom(url, *, http):
        raise ValueError("not a real posting id")

    monkeypatch.setattr(
        SOURCES["greenhouse"], "fetch_one_url", _boom
    )

    r = client.post(
        "/postings/from_url",
        json={"url": "https://boards.greenhouse.io/anthropic/jobs/1"},
        cookies=cookies,
    )
    assert r.status_code == 422
    assert "not a real posting id" in r.json()["detail"]
