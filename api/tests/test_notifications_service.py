"""Tests for ``app.services.notifications.send``.

Covers: row insertion, ntfy POST happy path, ntfy POST failure (row remains
with ``delivered_at=None``), and missing ``NTFY_TOPIC`` env var (skip POST,
row inserted, no raise).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Notification, User


async def _ensure_user(sm) -> None:
    async with sm() as s:
        existing = (
            await s.execute(select(User).where(User.id == 1))
        ).scalar_one_or_none()
        if existing is None:
            s.add(User(id=1))
            await s.commit()


class _FakeAsyncResponse:
    def __init__(self, status_code: int = 200) -> None:
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class _FakeAsyncClient:
    def __init__(self, *, capture: list[dict], status_code: int = 200,
                 raise_on_post: bool = False) -> None:
        self._capture = capture
        self._status = status_code
        self._raise = raise_on_post

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def post(self, url, *, content=None, headers=None, **kwargs):
        if self._raise:
            raise RuntimeError("network down")
        self._capture.append(
            {"url": url, "content": content, "headers": dict(headers or {})}
        )
        return _FakeAsyncResponse(status_code=self._status)


@pytest.mark.asyncio
async def test_send_writes_row_and_posts_ntfy(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)

    monkeypatch.setenv("NTFY_TOPIC", "hirescript-test")

    captured: list[dict] = []
    import httpx
    from app.services import notifications

    def fake_client(*args, **kwargs):
        return _FakeAsyncClient(capture=captured)

    monkeypatch.setattr(httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(notifications.httpx, "AsyncClient", fake_client)

    async with sm() as s:
        n = await notifications.send(
            s,
            user_id=1,
            kind="captcha_pause",
            title="Captcha required",
            body="Application 12 paused on a Greenhouse captcha.",
            meta={"application_id": 12},
        )

    assert n.id is not None
    assert n.kind == "captcha_pause"
    assert n.delivered_at is not None
    assert n.meta == {"application_id": 12}

    assert len(captured) == 1
    assert captured[0]["url"] == "https://ntfy.sh/hirescript-test"
    assert captured[0]["content"] == b"Application 12 paused on a Greenhouse captcha."
    assert captured[0]["headers"].get("Title") == "Captcha required"

    async with sm() as s:
        row = (
            await s.execute(select(Notification).where(Notification.id == n.id))
        ).scalar_one()
        assert row.delivered_at is not None


@pytest.mark.asyncio
async def test_send_swallows_ntfy_failure(monkeypatch, sessionmaker_factory):
    sm = sessionmaker_factory
    await _ensure_user(sm)

    monkeypatch.setenv("NTFY_TOPIC", "hirescript-test")

    import httpx
    from app.services import notifications

    def fake_client(*args, **kwargs):
        return _FakeAsyncClient(capture=[], raise_on_post=True)

    monkeypatch.setattr(httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(notifications.httpx, "AsyncClient", fake_client)

    async with sm() as s:
        n = await notifications.send(
            s,
            user_id=1,
            kind="submit_failed",
            title="Submit failed",
            body="boom",
        )

    assert n.id is not None
    assert n.delivered_at is None  # POST failed but row persists.


@pytest.mark.asyncio
async def test_send_skips_when_topic_unset(
    monkeypatch, sessionmaker_factory
):
    sm = sessionmaker_factory
    await _ensure_user(sm)

    monkeypatch.delenv("NTFY_TOPIC", raising=False)

    import httpx
    from app.services import notifications

    called = {"n": 0}

    def fake_client(*args, **kwargs):
        called["n"] += 1
        return _FakeAsyncClient(capture=[])

    monkeypatch.setattr(httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(notifications.httpx, "AsyncClient", fake_client)

    async with sm() as s:
        n = await notifications.send(
            s,
            user_id=1,
            kind="amode_paused",
            title="A-mode paused",
            body="kill switch active",
        )

    assert n.id is not None
    assert n.delivered_at is None  # No topic configured, no POST attempted.
    assert called["n"] == 0
