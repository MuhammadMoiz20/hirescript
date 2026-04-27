"""Tests for ``GET /sources`` — surfaces source name + tos_risk to UI."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login():
    client.post("/auth/login", json={"password": "changeme"})


def test_sources_route_requires_auth():
    client.cookies.clear()
    r = client.get("/sources")
    assert r.status_code in (401, 403)


def test_sources_route_returns_name_and_tos_risk():
    _login()
    try:
        r = client.get("/sources")
        assert r.status_code == 200
        body = r.json()
        names = {item["name"]: item for item in body}
        # ATS sources are clean.
        assert names["greenhouse"]["tos_risk"] == "clean"
        assert names["lever"]["tos_risk"] == "clean"
        assert names["ashby"]["tos_risk"] == "clean"
        assert names["workable"]["tos_risk"] == "clean"
        # New scrapers are high.
        assert names["linkedin"]["tos_risk"] == "high"
        assert names["indeed"]["tos_risk"] == "high"
        assert names["wellfound"]["tos_risk"] == "high"
    finally:
        client.cookies.clear()
