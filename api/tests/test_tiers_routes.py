"""Tier policy CRUD route tests."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.db import SessionLocal
from app.main import app
from app.models import Tier

client = TestClient(app)


_DEFAULTS = {
    "dream": {
        "daily_cap": 999,
        "default_mode": "B",
        "tailor_model": "opus-4.7",
        "enabled": True,
    },
    "targeted": {
        "daily_cap": 20,
        "default_mode": "A",
        "tailor_model": "sonnet-4.6",
        "enabled": True,
    },
    "wide_net": {
        "daily_cap": 50,
        "default_mode": "A",
        "tailor_model": "sonnet-4.6",
        "enabled": True,
    },
    "skip": {
        "daily_cap": 0,
        "default_mode": "B",
        "tailor_model": "haiku-4.5",
        "enabled": True,
    },
}


@pytest.fixture(autouse=True)
def _reset_tiers():
    """Restore tiers to seed defaults around each test."""

    async def _restore():
        async with SessionLocal() as s:
            for slug, vals in _DEFAULTS.items():
                await s.execute(
                    update(Tier).where(Tier.slug == slug).values(**vals)
                )
            await s.commit()

    asyncio.run(_restore())
    yield
    asyncio.run(_restore())
    client.cookies.clear()


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def test_tiers_require_auth():
    r = client.get("/tiers")
    assert r.status_code == 401


def test_list_tiers_returns_four_ordered_by_min_fit_desc():
    cookies = _login()
    r = client.get("/tiers", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 4
    slugs = [t["slug"] for t in body]
    # min_fit_score: dream=85, targeted=65, wide_net=40, skip=0
    assert slugs == ["dream", "targeted", "wide_net", "skip"]


def test_patch_updates_and_persists():
    cookies = _login()
    r = client.patch(
        "/tiers/targeted",
        json={"daily_cap": 5, "default_mode": "B"},
        cookies=cookies,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == "targeted"
    assert body["daily_cap"] == 5
    assert body["default_mode"] == "B"

    async def _read():
        async with SessionLocal() as s:
            return (
                await s.execute(select(Tier).where(Tier.slug == "targeted"))
            ).scalar_one()

    persisted = asyncio.run(_read())
    assert persisted.daily_cap == 5
    assert persisted.default_mode == "B"


def test_patch_rejects_invalid_default_mode():
    cookies = _login()
    r = client.patch(
        "/tiers/targeted",
        json={"default_mode": "C"},
        cookies=cookies,
    )
    assert r.status_code == 422


def test_patch_rejects_unknown_slug_404():
    cookies = _login()
    r = client.patch(
        "/tiers/does_not_exist",
        json={"daily_cap": 1},
        cookies=cookies,
    )
    assert r.status_code == 404


def test_patch_rejects_immutable_fields():
    cookies = _login()
    r = client.patch(
        "/tiers/targeted",
        json={"slug": "renamed"},
        cookies=cookies,
    )
    assert r.status_code == 422

    r2 = client.patch(
        "/tiers/targeted",
        json={"min_fit_score": 99},
        cookies=cookies,
    )
    assert r2.status_code == 422
