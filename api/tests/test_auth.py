from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_login_with_correct_password_sets_cookie():
    r = client.post("/auth/login", json={"password": "changeme"})
    assert r.status_code == 200
    assert "session" in r.cookies

def test_login_with_wrong_password_rejected():
    r = client.post("/auth/login", json={"password": "nope"})
    assert r.status_code == 401

def test_protected_route_requires_cookie():
    r = client.get("/auth/me")
    assert r.status_code == 401

def test_protected_route_works_with_cookie():
    login = client.post("/auth/login", json={"password": "changeme"})
    r = client.get("/auth/me", cookies=login.cookies)
    assert r.status_code == 200
    assert r.json() == {"user_id": 1}
