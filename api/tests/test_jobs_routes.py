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


def _seed_job_with_events(events):
    """Insert a Job and a list of JobEvent rows directly via the async session.

    `events` is a list of dicts: {phase, message?, data?}.
    Returns (job_id, [event_id, ...]).
    """
    import asyncio
    from app.db import SessionLocal
    from app.models import Job, JobEvent

    async def _run():
        async with SessionLocal() as s:
            j = Job(kind="tailor", status="succeeded", payload={}, result={"page_count": 1})
            s.add(j)
            await s.flush()
            ev_objs = []
            for e in events:
                ev = JobEvent(
                    job_id=j.id,
                    phase=e["phase"],
                    message=e.get("message"),
                    data=e.get("data"),
                )
                s.add(ev)
                ev_objs.append(ev)
            await s.commit()
            for ev in ev_objs:
                await s.refresh(ev)
            return j.id, [ev.id for ev in ev_objs]

    return asyncio.run(_run())


def test_events_stream_terminates_on_done():
    cookies = _login()
    job_id, _ = _seed_job_with_events(
        [
            {"phase": "draft_start", "data": {}},
            {"phase": "done", "data": {"page_count": 1}},
        ]
    )
    chunks: list[str] = []
    with client.stream("GET", f"/api/jobs/{job_id}/events", cookies=cookies) as r:
        assert r.status_code == 200
        for line in r.iter_lines():
            chunks.append(line)
            if "event: done" in line:
                # consume the data line + blank, then break
                break
    body = "\n".join(chunks)
    assert "event: phase" in body
    assert "draft_start" in body
    assert "event: done" in body


def test_events_stream_respects_cursor():
    cookies = _login()
    job_id, ids = _seed_job_with_events(
        [
            {"phase": "a", "data": {}},
            {"phase": "done", "data": {}},
        ]
    )
    first_id = ids[0]
    body_parts: list[str] = []
    with client.stream(
        "GET",
        f"/api/jobs/{job_id}/events",
        params={"cursor": first_id},
        cookies=cookies,
    ) as r:
        assert r.status_code == 200
        for chunk in r.iter_text():
            body_parts.append(chunk)
            if "event: done" in "".join(body_parts):
                break
    body = "".join(body_parts)
    # first event ("a") must NOT be present; only `done` should arrive
    assert '"phase": "a"' not in body
    assert "event: done" in body


def test_events_stream_requires_auth():
    import uuid as _uuid

    r = client.get(f"/api/jobs/{_uuid.uuid4()}/events")
    assert r.status_code == 401


def _seed_job(status: str):
    """Insert a single Job with the given status. Returns job_id."""
    import asyncio
    from app.db import SessionLocal
    from app.models import Job

    async def _run():
        async with SessionLocal() as s:
            j = Job(kind="tailor", status=status, payload={})
            s.add(j)
            await s.commit()
            await s.refresh(j)
            return j.id

    return asyncio.run(_run())


def _get_job_status(job_id):
    import asyncio
    from app.db import SessionLocal
    from app.models import Job
    from sqlalchemy import select

    async def _run():
        async with SessionLocal() as s:
            j = (
                await s.execute(select(Job).where(Job.id == job_id))
            ).scalar_one()
            return j.status

    return asyncio.run(_run())


def test_cancel_queued_job():
    cookies = _login()
    job_id = _seed_job("queued")
    r = client.post(f"/api/jobs/{job_id}/cancel", cookies=cookies)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    assert _get_job_status(job_id) == "cancelled"


def test_cancel_running_job():
    cookies = _login()
    job_id = _seed_job("running")
    r = client.post(f"/api/jobs/{job_id}/cancel", cookies=cookies)
    assert r.status_code == 200, r.text
    assert _get_job_status(job_id) == "cancelled"


def test_cancel_terminal_job_returns_409():
    cookies = _login()
    for status in ("succeeded", "failed", "cancelled"):
        job_id = _seed_job(status)
        r = client.post(f"/api/jobs/{job_id}/cancel", cookies=cookies)
        assert r.status_code == 409, f"{status}: {r.text}"


def test_cancel_requires_auth():
    import uuid as _uuid

    r = client.post(f"/api/jobs/{_uuid.uuid4()}/cancel")
    assert r.status_code == 401
