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


def _enqueue(cookies, resume_id, items, deep=False):
    r = client.post(
        "/api/jobs/tailor",
        json={"resume_id": resume_id, "items": items, "deep": deep},
        cookies=cookies,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_list_jobs_returns_items_and_total():
    master, cookies = _create_master()
    _enqueue(
        cookies,
        master["id"],
        [
            {"jd_text": "JD A", "title": "SWE", "company": "Acme"},
            {"jd_text": "JD B", "title": "SWE", "company": "Beta"},
        ],
    )
    r = client.get("/api/jobs", cookies=cookies)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data and "total" in data
    assert data["total"] >= 2
    assert len(data["items"]) >= 2
    j = data["items"][0]
    for f in (
        "id",
        "kind",
        "status",
        "batch_id",
        "payload",
        "attempts",
        "created_at",
    ):
        assert f in j


def test_list_jobs_filters_by_status():
    master, cookies = _create_master()
    _enqueue(
        cookies,
        master["id"],
        [{"jd_text": "JD A", "title": "SWE", "company": "Acme"}],
    )
    r = client.get("/api/jobs", params={"status": "queued"}, cookies=cookies)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 1
    for item in data["items"]:
        assert item["status"] == "queued"

    r2 = client.get("/api/jobs", params={"status": "succeeded"}, cookies=cookies)
    assert r2.status_code == 200
    for item in r2.json()["items"]:
        assert item["status"] == "succeeded"


def test_list_jobs_filters_by_status_csv():
    master, cookies = _create_master()
    _enqueue(
        cookies,
        master["id"],
        [{"jd_text": "JD A", "title": "SWE", "company": "Acme"}],
    )
    r = client.get(
        "/api/jobs", params={"status": "queued,running"}, cookies=cookies
    )
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["status"] in ("queued", "running")


def test_list_jobs_filters_by_batch_id():
    master, cookies = _create_master()
    enq = _enqueue(
        cookies,
        master["id"],
        [
            {"jd_text": "JD A", "title": "SWE", "company": "Acme"},
            {"jd_text": "JD B", "title": "SWE", "company": "Beta"},
        ],
    )
    bid = enq["batch_id"]
    _enqueue(
        cookies,
        master["id"],
        [{"jd_text": "JD C", "title": "SWE", "company": "Gamma"}],
    )
    r = client.get("/api/jobs", params={"batch_id": bid}, cookies=cookies)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2
    for item in data["items"]:
        assert item["batch_id"] == bid


def test_list_jobs_pagination():
    master, cookies = _create_master()
    _enqueue(
        cookies,
        master["id"],
        [
            {"jd_text": "JD A", "title": "SWE", "company": "Acme"},
            {"jd_text": "JD B", "title": "SWE", "company": "Beta"},
            {"jd_text": "JD C", "title": "SWE", "company": "Gamma"},
        ],
    )
    r = client.get(
        "/api/jobs", params={"limit": 2, "offset": 0}, cookies=cookies
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) == 2
    assert data["total"] >= 3


def test_get_job_detail():
    master, cookies = _create_master()
    enq = _enqueue(
        cookies,
        master["id"],
        [{"jd_text": "JD A", "title": "SWE", "company": "Acme"}],
    )
    job_id = enq["job_ids"][0]
    r = client.get(f"/api/jobs/{job_id}", cookies=cookies)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["id"] == job_id
    assert data["status"] == "queued"
    assert data["kind"] == "tailor"


def test_get_job_404():
    cookies = _login()
    import uuid as _uuid

    r = client.get(f"/api/jobs/{_uuid.uuid4()}", cookies=cookies)
    assert r.status_code == 404


def test_list_jobs_requires_auth():
    r = client.get("/api/jobs")
    assert r.status_code == 401


def test_get_job_requires_auth():
    import uuid as _uuid

    r = client.get(f"/api/jobs/{_uuid.uuid4()}")
    assert r.status_code == 401
