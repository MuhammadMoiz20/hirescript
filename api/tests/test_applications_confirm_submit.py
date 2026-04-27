"""Tests for ``POST /applications/{id}/confirm_submit``.

The endpoint is the user-facing half of the browser-agent submit fallback:
the runner parks the row awaiting confirmation; the user reviews the
agent's screenshot + form summary in the queue and confirms here.
"""

from __future__ import annotations

import asyncio

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
            await s.execute(delete(Job))
            await s.execute(delete(Company))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


async def _seed_awaiting(*, agent_session_id: str = "sess-xyz") -> int:
    async with SessionLocal() as s:
        p = JobPosting(
            user_id=1,
            source="unknown-ats",
            source_job_id="1",
            title="Engineer",
            location="Remote",
            apply_url="https://weirdco.example/jobs/1",
            description_text="x",
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
            status="awaiting_confirmation",
            cover_letter_text="x",
            form_payload={"first_name": "Moiz"},
            canonical_key="weirdco|jobs/1",
            agent_session_id=agent_session_id,
            awaiting_user_confirmation=True,
            confirmation_screenshot_path="/tmp/agent_pause_1.png",
        )
        s.add(a)
        await s.commit()
        await s.refresh(a)
        return a.id


def test_confirm_submit_requires_auth():
    r = client.post("/applications/1/confirm_submit")
    assert r.status_code == 401


def test_confirm_submit_marks_application_submitted():
    """Happy path: a paused agent run, the user confirms, the row flips
    to submitted with a fresh submitted_at and the awaiting flag clears."""
    _login()
    app_id = asyncio.run(_seed_awaiting())

    r = client.post(f"/applications/{app_id}/confirm_submit")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "submitted"
    assert body["submitted_at"] is not None
    assert body["agent_session_id"] == "sess-xyz"

    async def _check():
        async with SessionLocal() as s:
            row = (
                await s.execute(
                    select(Application).where(Application.id == app_id)
                )
            ).scalar_one()
            assert row.status == "submitted"
            assert row.awaiting_user_confirmation is False
            assert row.submitted_at is not None
            assert row.error is None

    asyncio.run(_check())


def test_confirm_submit_rejects_application_not_awaiting():
    """409 if the row isn't actually parked awaiting — protects against a
    double-confirm or a confirm of an already-submitted row."""
    _login()

    async def _seed():
        async with SessionLocal() as s:
            p = JobPosting(
                user_id=1, source="greenhouse", source_job_id="2",
                title="t", location="Remote",
                apply_url="https://example.test/jobs/2",
                description_text="x", meta={}, status="ready",
            )
            s.add(p)
            await s.commit()
            await s.refresh(p)
            a = Application(
                user_id=1, posting_id=p.id, mode="B", status="prepared",
                form_payload={}, canonical_key="acme|2",
                awaiting_user_confirmation=False,
            )
            s.add(a)
            await s.commit()
            await s.refresh(a)
            return a.id

    app_id = asyncio.run(_seed())

    r = client.post(f"/applications/{app_id}/confirm_submit")
    assert r.status_code == 409
    assert "not awaiting" in r.json()["detail"]


def test_confirm_submit_404_for_unknown_application():
    _login()
    r = client.post("/applications/9999999/confirm_submit")
    assert r.status_code == 404
