import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal, engine
from app.main import app
from app.models import Profile as ProfileModel

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_profile():
    async def _run():
        async with SessionLocal() as s:
            await s.execute(delete(ProfileModel))
            await s.commit()
        await engine.dispose()

    asyncio.run(_run())
    yield


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


class _Authed:
    def __init__(self, cookies):
        self._cookies = cookies

    def get(self, url):
        return client.get(url, cookies=self._cookies)

    def put(self, url, json):
        return client.put(url, json=json, cookies=self._cookies)


def _client_authed():
    return _Authed(_login())


def test_get_profile_returns_empty_shell_when_unset():
    client_authed = _client_authed()
    r = client_authed.get("/profile")
    assert r.status_code == 200
    assert r.json()["legal_name"] == ""


def test_put_profile_persists():
    client_authed = _client_authed()
    payload = {"legal_name": "Moiz", "email": "m@x.com", "preferences": {"salary_floor_usd": 200000}}
    r = client_authed.put("/profile", json=payload)
    assert r.status_code == 200
    r2 = client_authed.get("/profile")
    assert r2.json()["legal_name"] == "Moiz"
    assert r2.json()["preferences"]["salary_floor_usd"] == 200000


def test_put_profile_rejects_invalid():
    client_authed = _client_authed()
    r = client_authed.put("/profile", json={"legal_name": "x", "email": "not-an-email"})
    assert r.status_code == 422
