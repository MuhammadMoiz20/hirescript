"""Companies CRUD route tests.

The sanity-check fetch in POST is mocked via ``monkeypatch.setattr`` on
the registered adapter so no real network traffic happens.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.main import app
from app.models import Company
from app.services.sources import SOURCES

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_companies():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(delete(Company))
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _stub_fetch(monkeypatch, *, source: str, postings):
    async def _fake(slug, *, http):
        return postings

    monkeypatch.setattr(
        SOURCES[source], "fetch_company_postings", _fake
    )


def _one_posting():
    return [
        {
            "source_job_id": "1",
            "title": "Engineer",
            "location": "Remote",
            "apply_url": "https://example.test/jobs/1",
            "description_html": "<p>x</p>",
            "description_text": "x",
            "meta": {},
        }
    ]


# --- Auth gate ---------------------------------------------------------------


def test_companies_require_auth():
    assert client.get("/companies").status_code == 401
    assert client.post("/companies", json={}).status_code == 401
    assert client.patch("/companies/1", json={}).status_code == 401
    assert client.delete("/companies/1").status_code == 401


# --- GET /companies ---------------------------------------------------------


def test_list_companies_returns_all():
    cookies = _login()

    async def _seed():
        async with SessionLocal() as s:
            s.add(Company(slug="a", display_name="A", source="greenhouse"))
            s.add(Company(slug="b", display_name="B", source="lever"))
            s.add(Company(slug="c", display_name="C", source="ashby"))
            await s.commit()

    asyncio.run(_seed())

    r = client.get("/companies", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {c["slug"] for c in body} == {"a", "b", "c"}


def test_list_companies_filters_by_source():
    cookies = _login()

    async def _seed():
        async with SessionLocal() as s:
            s.add(Company(slug="a", display_name="A", source="greenhouse"))
            s.add(Company(slug="b", display_name="B", source="lever"))
            await s.commit()

    asyncio.run(_seed())

    r = client.get("/companies?source=lever", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["slug"] == "b"
    assert body[0]["source"] == "lever"


# --- POST /companies --------------------------------------------------------


def test_create_company_happy_path(monkeypatch):
    cookies = _login()
    _stub_fetch(monkeypatch, source="greenhouse", postings=_one_posting())

    r = client.post(
        "/companies",
        json={
            "source": "greenhouse",
            "slug": "anthropic",
            "display_name": "Anthropic",
        },
        cookies=cookies,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "greenhouse"
    assert body["slug"] == "anthropic"
    assert body["display_name"] == "Anthropic"
    assert body["enabled"] is True

    async def _check():
        async with SessionLocal() as s:
            return (
                await s.execute(
                    select(Company).where(Company.slug == "anthropic")
                )
            ).scalar_one()

    row = asyncio.run(_check())
    assert row.enabled is True


def test_create_company_rejects_unknown_source():
    cookies = _login()
    r = client.post(
        "/companies",
        json={
            "source": "totallyfakesource",
            "slug": "x",
            "display_name": "X",
        },
        cookies=cookies,
    )
    assert r.status_code == 422
    assert "unknown source" in r.json()["detail"]


def test_create_company_rejects_zero_postings(monkeypatch):
    cookies = _login()
    _stub_fetch(monkeypatch, source="greenhouse", postings=[])

    r = client.post(
        "/companies",
        json={
            "source": "greenhouse",
            "slug": "doesnotexist",
            "display_name": "Nope",
        },
        cookies=cookies,
    )
    assert r.status_code == 422
    assert "zero postings" in r.json()["detail"]

    # No row was inserted.
    async def _check():
        async with SessionLocal() as s:
            return (
                await s.execute(
                    select(Company).where(Company.slug == "doesnotexist")
                )
            ).scalar_one_or_none()

    assert asyncio.run(_check()) is None


def test_create_company_rejects_when_fetch_raises(monkeypatch):
    cookies = _login()

    async def _boom(slug, *, http):
        raise RuntimeError("upstream 503")

    monkeypatch.setattr(
        SOURCES["greenhouse"], "fetch_company_postings", _boom
    )

    r = client.post(
        "/companies",
        json={
            "source": "greenhouse",
            "slug": "broken",
            "display_name": "Broken",
        },
        cookies=cookies,
    )
    assert r.status_code == 422
    assert "sanity-check fetch failed" in r.json()["detail"]


def test_create_company_duplicate_returns_409(monkeypatch):
    cookies = _login()
    _stub_fetch(monkeypatch, source="greenhouse", postings=_one_posting())

    body = {
        "source": "greenhouse",
        "slug": "anthropic",
        "display_name": "Anthropic",
    }
    r1 = client.post("/companies", json=body, cookies=cookies)
    assert r1.status_code == 201

    r2 = client.post("/companies", json=body, cookies=cookies)
    assert r2.status_code == 409


# --- PATCH /companies/{id} --------------------------------------------------


def test_patch_company_renames(monkeypatch):
    cookies = _login()

    async def _seed():
        async with SessionLocal() as s:
            c = Company(slug="a", display_name="Old", source="greenhouse")
            s.add(c)
            await s.commit()
            await s.refresh(c)
            return c.id

    cid = asyncio.run(_seed())

    r = client.patch(
        f"/companies/{cid}",
        json={"display_name": "New"},
        cookies=cookies,
    )
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "New"
    # enabled untouched.
    assert r.json()["enabled"] is True


def test_patch_company_toggles_enabled():
    cookies = _login()

    async def _seed():
        async with SessionLocal() as s:
            c = Company(slug="a", display_name="A", source="greenhouse")
            s.add(c)
            await s.commit()
            await s.refresh(c)
            return c.id

    cid = asyncio.run(_seed())

    r = client.patch(
        f"/companies/{cid}", json={"enabled": False}, cookies=cookies
    )
    assert r.status_code == 200
    assert r.json()["enabled"] is False


def test_patch_company_404_when_missing():
    cookies = _login()
    r = client.patch(
        "/companies/9999999", json={"enabled": False}, cookies=cookies
    )
    assert r.status_code == 404


# --- DELETE /companies/{id} (soft) ------------------------------------------


def test_delete_company_soft_deletes():
    cookies = _login()

    async def _seed():
        async with SessionLocal() as s:
            c = Company(slug="a", display_name="A", source="greenhouse")
            s.add(c)
            await s.commit()
            await s.refresh(c)
            return c.id

    cid = asyncio.run(_seed())

    r = client.delete(f"/companies/{cid}", cookies=cookies)
    assert r.status_code == 204

    async def _check():
        async with SessionLocal() as s:
            return (
                await s.execute(
                    select(Company).where(Company.id == cid)
                )
            ).scalar_one()

    row = asyncio.run(_check())
    # Row still exists (soft delete).
    assert row is not None
    assert row.enabled is False


def test_delete_company_404_when_missing():
    cookies = _login()
    r = client.delete("/companies/9999999", cookies=cookies)
    assert r.status_code == 404
