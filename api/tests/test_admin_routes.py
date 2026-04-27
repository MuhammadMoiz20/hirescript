"""Admin / E2E seed route tests.

The admin route is gated behind ``E2E_TESTING=1``. Outside that env
flag it must 404, regardless of auth state, so it cannot be used in
production.
"""

from __future__ import annotations

import asyncio
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.main import app
from app.models import Company, JobPosting

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(delete(JobPosting).where(JobPosting.user_id == 1))
            await s.execute(delete(Company))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    client.post("/auth/login", json={"password": "changeme"})


def _seed_body(**overrides):
    body = {
        "company_slug": "acme",
        "company_name": "Acme",
        "source_job_id": "abc-123",
        "title": "Senior Engineer",
        "apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "description_text": "We need a backend engineer.",
        "location": "Remote",
    }
    body.update(overrides)
    return body


def test_seed_posting_404_when_e2e_disabled(monkeypatch):
    monkeypatch.delenv("E2E_TESTING", raising=False)
    _login()
    res = client.post("/admin/seed-posting", json=_seed_body())
    assert res.status_code == 404


def test_seed_posting_creates_company_and_posting(monkeypatch):
    monkeypatch.setenv("E2E_TESTING", "1")
    _login()
    res = client.post("/admin/seed-posting", json=_seed_body())
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["created"] is True
    assert payload["id"] > 0
    assert payload["company_id"] > 0


def test_seed_posting_idempotent(monkeypatch):
    monkeypatch.setenv("E2E_TESTING", "1")
    _login()
    first = client.post("/admin/seed-posting", json=_seed_body()).json()
    second = client.post("/admin/seed-posting", json=_seed_body()).json()
    assert first["id"] == second["id"]
    assert second["created"] is False


def test_seed_posting_requires_auth(monkeypatch):
    monkeypatch.setenv("E2E_TESTING", "1")
    # No login.
    res = client.post("/admin/seed-posting", json=_seed_body())
    assert res.status_code == 401
