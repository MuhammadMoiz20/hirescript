"""Notifications API route tests."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.main import app
from app.models import Notification

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_notifs():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(
                delete(Notification).where(Notification.user_id == 1)
            )
            await s.commit()

    asyncio.run(_run())
    yield
    asyncio.run(_run())
    client.cookies.clear()


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


async def _seed(kind: str, *, read: bool = False) -> int:
    async with SessionLocal() as s:
        n = Notification(
            user_id=1,
            kind=kind,
            title=f"t-{kind}",
            body=f"b-{kind}",
            meta={},
            read_at=datetime.now(timezone.utc) if read else None,
        )
        s.add(n)
        await s.commit()
        await s.refresh(n)
        return n.id


def test_notifications_require_auth():
    r = client.get("/notifications")
    assert r.status_code == 401


def test_list_notifications_newest_first():
    cookies = _login()
    a = asyncio.run(_seed("captcha_pause"))
    b = asyncio.run(_seed("verify_blocked"))
    c = asyncio.run(_seed("submit_failed"))

    r = client.get("/notifications", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [n["id"] for n in body]
    # Newest first.
    assert ids == [c, b, a]


def test_list_notifications_unread_only_filter():
    cookies = _login()
    asyncio.run(_seed("captcha_pause", read=True))
    unread_id = asyncio.run(_seed("verify_blocked", read=False))

    r = client.get("/notifications?unread_only=true", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    ids = [n["id"] for n in body]
    assert ids == [unread_id]


def test_list_notifications_respects_limit():
    cookies = _login()
    for _ in range(5):
        asyncio.run(_seed("captcha_pause"))
    r = client.get("/notifications?limit=2", cookies=cookies)
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_post_read_marks_read():
    cookies = _login()
    nid = asyncio.run(_seed("captcha_pause"))
    r = client.post(f"/notifications/{nid}/read", cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == nid
    assert body["read_at"] is not None

    async def _read():
        async with SessionLocal() as s:
            return (
                await s.execute(
                    select(Notification).where(Notification.id == nid)
                )
            ).scalar_one()

    row = asyncio.run(_read())
    assert row.read_at is not None


def test_post_read_404_for_missing():
    cookies = _login()
    r = client.post("/notifications/999999/read", cookies=cookies)
    assert r.status_code == 404
