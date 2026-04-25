from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.compile import CompileResult, CompileError

client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _create():
    cookies = _login()
    rid = client.post(
        "/resumes",
        json={"name": "S", "template_id": "jakes"},
        cookies=cookies,
    ).json()["id"]
    return cookies, rid


def test_get_sections_returns_schema_and_parses_content():
    cookies, rid = _create()
    r = client.get(f"/resumes/{rid}/sections", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["template_id"] == "jakes"
    assert "schema" in body
    assert body["content_json"]["header"]["name"]


def test_put_sections_persists_when_one_page():
    cookies, rid = _create()
    body = client.get(f"/resumes/{rid}/sections", cookies=cookies).json()
    body["content_json"]["header"]["name"] = "Edited Name"
    with patch(
        "app.routes.resumes.compile_latex",
        return_value=CompileResult(pdf=b"%PDF...", page_count=1),
    ):
        r = client.put(
            f"/resumes/{rid}/sections",
            cookies=cookies,
            json={"content_json": body["content_json"]},
        )
    assert r.status_code == 200
    r2 = client.get(f"/resumes/{rid}", cookies=cookies)
    assert "Edited Name" in r2.json()["latex_source"]


def test_put_sections_rejects_multi_page():
    cookies, rid = _create()
    body = client.get(f"/resumes/{rid}/sections", cookies=cookies).json()
    with patch(
        "app.routes.resumes.compile_latex",
        return_value=CompileResult(pdf=b"%PDF...", page_count=2),
    ):
        r = client.put(
            f"/resumes/{rid}/sections",
            cookies=cookies,
            json={"content_json": body["content_json"]},
        )
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "not_one_page"


def test_put_sections_rejects_compile_failure():
    cookies, rid = _create()
    body = client.get(f"/resumes/{rid}/sections", cookies=cookies).json()
    with patch(
        "app.routes.resumes.compile_latex",
        side_effect=CompileError("LaTeX boom"),
    ):
        r = client.put(
            f"/resumes/{rid}/sections",
            cookies=cookies,
            json={"content_json": body["content_json"]},
        )
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "compile_failed"


def test_sections_requires_auth():
    client.cookies.clear()
    r = client.get("/resumes/1/sections")
    assert r.status_code == 401
