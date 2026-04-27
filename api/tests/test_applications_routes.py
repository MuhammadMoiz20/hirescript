"""Applications route tests."""

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
def _clean_apps():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(delete(Application).where(Application.user_id == 1))
            await s.execute(
                delete(JobPosting).where(JobPosting.user_id == 1)
            )
            await s.execute(
                delete(Job).where(Job.kind == "submit_application")
            )
            await s.execute(delete(Company))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


async def _seed_posting_and_app(
    *,
    source_job_id: str = "1",
    status: str = "prepared",
    cover_letter: str | None = "Cover letter body.",
    form_payload: dict | None = None,
) -> tuple[int, int]:
    async with SessionLocal() as s:
        p = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id=source_job_id,
            title="Engineer",
            location="Remote",
            apply_url=f"https://example.test/jobs/{source_job_id}",
            description_text="desc",
            meta={},
            status="ready",
        )
        s.add(p)
        await s.commit()
        await s.refresh(p)
        a = Application(
            user_id=1,
            posting_id=p.id,
            mode="B",
            status=status,
            cover_letter_text=cover_letter,
            form_payload=form_payload or {"first_name": "Moiz"},
            canonical_key=f"acme::https://example.test/jobs/{source_job_id}",
        )
        s.add(a)
        await s.commit()
        await s.refresh(a)
        return p.id, a.id


def test_applications_require_auth():
    r = client.get("/applications")
    assert r.status_code == 401


def test_list_applications_defaults_to_prepared():
    cookies = _login()
    asyncio.run(_seed_posting_and_app(source_job_id="1", status="prepared"))
    asyncio.run(_seed_posting_and_app(source_job_id="2", status="submitted"))
    asyncio.run(_seed_posting_and_app(source_job_id="3", status="errored"))

    r = client.get("/applications", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "prepared"


def test_list_applications_filters_by_status_explicit():
    cookies = _login()
    asyncio.run(_seed_posting_and_app(source_job_id="1", status="prepared"))
    asyncio.run(_seed_posting_and_app(source_job_id="2", status="submitted"))

    r = client.get("/applications?status=submitted", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "submitted"


def test_get_application_returns_full_detail():
    cookies = _login()
    pid, aid = asyncio.run(
        _seed_posting_and_app(
            source_job_id="42",
            cover_letter="Hello team",
            form_payload={"first_name": "Moiz", "email": "m@x.com"},
        )
    )

    r = client.get(f"/applications/{aid}", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == aid
    assert body["posting_id"] == pid
    assert body["posting"]["id"] == pid
    assert body["cover_letter_text"] == "Hello team"
    assert body["form_payload"]["email"] == "m@x.com"
    assert body["canonical_key"]
    assert body["prepared_at"]
    # No version seeded → no PDF URL.
    assert body["resume_pdf_url"] is None
    # Confirmation artifacts default to None until submission populates them.
    assert body["confirmation_html"] is None
    assert body["confirmation_screenshot_path"] is None


def test_get_application_404_for_missing():
    cookies = _login()
    r = client.get("/applications/999999", cookies=cookies)
    assert r.status_code == 404


def test_post_submit_enqueues_job():
    cookies = _login()
    _, aid = asyncio.run(_seed_posting_and_app(source_job_id="9"))

    r = client.post(f"/applications/{aid}/submit", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    job_uuid = uuid.UUID(body["job_id"])

    async def _check():
        async with SessionLocal() as s:
            job = (
                await s.execute(select(Job).where(Job.id == job_uuid))
            ).scalar_one()
            return job.kind, job.payload

    kind, payload = asyncio.run(_check())
    assert kind == "submit_application"
    assert payload == {"application_id": aid}


def test_delete_application_removes_row():
    cookies = _login()
    _, aid = asyncio.run(_seed_posting_and_app(source_job_id="9"))

    r = client.delete(f"/applications/{aid}", cookies=cookies)
    assert r.status_code == 204

    async def _check():
        async with SessionLocal() as s:
            row = (
                await s.execute(
                    select(Application).where(Application.id == aid)
                )
            ).scalar_one_or_none()
            return row

    assert asyncio.run(_check()) is None


def test_delete_application_404_for_missing():
    cookies = _login()
    r = client.delete("/applications/999999", cookies=cookies)
    assert r.status_code == 404
