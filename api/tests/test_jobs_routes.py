from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _create_master():
    cookies = _login()
    r = client.post(
        "/resumes",
        json={"name": "JobsRouteMaster", "template_id": "jakes"},
        cookies=cookies,
    )
    assert r.status_code == 201
    return r.json(), cookies


def test_enqueue_tailor_batch_creates_n_jobs():
    master, cookies = _create_master()
    body = {
        "resume_id": master["id"],
        "items": [
            {"jd_text": "JD A", "title": "SWE", "company": "Acme"},
            {"jd_text": "JD B", "title": "SWE II", "company": "Beta"},
        ],
        "deep": False,
    }
    r = client.post("/api/jobs/tailor", json=body, cookies=cookies)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "batch_id" in data
    assert len(data["job_ids"]) == 2
    # All job ids unique, single batch
    assert len(set(data["job_ids"])) == 2


def test_enqueue_tailor_empty_items_returns_400():
    master, cookies = _create_master()
    r = client.post(
        "/api/jobs/tailor",
        json={"resume_id": master["id"], "items": [], "deep": False},
        cookies=cookies,
    )
    assert r.status_code == 400


def test_enqueue_tailor_requires_auth():
    r = client.post(
        "/api/jobs/tailor",
        json={
            "resume_id": 1,
            "items": [{"jd_text": "x", "title": "t", "company": "c"}],
        },
    )
    assert r.status_code == 401
