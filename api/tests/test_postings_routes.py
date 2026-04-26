"""Postings route tests."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.main import app
from app.models import Application, Company, Job, JobPosting

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_postings():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(delete(Application).where(Application.user_id == 1))
            await s.execute(
                delete(JobPosting).where(JobPosting.user_id == 1)
            )
            await s.execute(
                delete(Job).where(Job.kind == "prepare_application")
            )
            await s.execute(delete(Company))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


async def _seed_company(slug: str = "acme") -> int:
    async with SessionLocal() as s:
        c = Company(slug=slug, display_name=slug.title(), source="greenhouse")
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.id


async def _seed_posting(
    *,
    source_job_id: str = "1",
    company_id: int | None = None,
    status: str = "new",
    tier: str | None = None,
    title: str = "Engineer",
) -> int:
    async with SessionLocal() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id=source_job_id,
            company_id=company_id,
            title=title,
            location="Remote",
            apply_url=f"https://example.test/jobs/{source_job_id}",
            description_text=f"Description for {source_job_id}",
            description_html=f"<p>Description for {source_job_id}</p>",
            meta={"k": "v"},
            tier=tier,
            status=status,
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        return p.id


def test_postings_require_auth():
    r = client.get("/postings")
    assert r.status_code == 401


def test_list_postings_returns_paginated():
    cookies = _login()
    asyncio.run(_seed_posting(source_job_id="1"))
    asyncio.run(_seed_posting(source_job_id="2"))
    asyncio.run(_seed_posting(source_job_id="3"))
    asyncio.run(_seed_posting(source_job_id="4"))
    asyncio.run(_seed_posting(source_job_id="5"))

    r = client.get("/postings?limit=2", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2


def test_list_postings_filters_by_status():
    cookies = _login()
    asyncio.run(_seed_posting(source_job_id="1", status="new"))
    asyncio.run(_seed_posting(source_job_id="2", status="new"))
    asyncio.run(_seed_posting(source_job_id="3", status="ready"))

    r = client.get("/postings?status=ready", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "ready"


def test_list_postings_filters_by_tier():
    cookies = _login()
    asyncio.run(_seed_posting(source_job_id="1", tier="dream"))
    asyncio.run(_seed_posting(source_job_id="2", tier="wide_net"))

    r = client.get("/postings?tier=dream", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["tier"] == "dream"


def test_get_posting_returns_detail_with_description():
    cookies = _login()
    cid = asyncio.run(_seed_company("acme"))
    pid = asyncio.run(
        _seed_posting(source_job_id="42", company_id=cid, title="Backend")
    )

    r = client.get(f"/postings/{pid}", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == pid
    assert body["title"] == "Backend"
    assert body["company"] == "Acme"
    assert "Description for 42" in body["description_text"]
    assert body["description_html"] is not None
    assert body["meta"] == {"k": "v"}


def test_get_posting_404_for_missing():
    cookies = _login()
    r = client.get("/postings/999999", cookies=cookies)
    assert r.status_code == 404


def test_post_prepare_enqueues_job():
    cookies = _login()
    pid = asyncio.run(_seed_posting(source_job_id="9"))

    r = client.post(f"/postings/{pid}/prepare", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    # Must be valid uuids.
    uuid.UUID(body["job_id"])
    uuid.UUID(body["batch_id"])

    async def _check():
        async with SessionLocal() as s:
            job = (
                await s.execute(
                    select(Job).where(Job.id == uuid.UUID(body["job_id"]))
                )
            ).scalar_one()
            return job.kind, job.payload, job.status

    kind, payload, status = asyncio.run(_check())
    assert kind == "prepare_application"
    assert payload == {"posting_id": pid}
    # Status may be "queued" or already "running" if a worker picked it up,
    # but in the test container no worker runs, so it should be queued.
    assert status in ("queued", "running")


def test_post_skip_sets_status():
    cookies = _login()
    pid = asyncio.run(_seed_posting(source_job_id="9", status="new"))

    r = client.post(f"/postings/{pid}/skip", cookies=cookies)
    assert r.status_code == 200
    assert r.json()["status"] == "skip"

    async def _check():
        async with SessionLocal() as s:
            p = (
                await s.execute(select(JobPosting).where(JobPosting.id == pid))
            ).scalar_one()
            return p.status

    assert asyncio.run(_check()) == "skip"
