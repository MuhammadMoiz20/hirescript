import json
from unittest.mock import patch, AsyncMock

from fastapi.testclient import TestClient

from app.main import app
from app.services.tailor import TailorResult


client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for raw in text.split("\n\n"):
        if not raw.strip():
            continue
        name = "message"
        data_lines: list[str] = []
        for line in raw.split("\n"):
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_lines.append(line.split(":", 1)[1].strip())
        if data_lines:
            events.append((name, json.loads("\n".join(data_lines))))
    return events


def _ok_result(
    latex="\\documentclass{article}\\begin{document}variant\\end{document}",
    enforced=True,
    page_count=1,
):
    return TailorResult(
        variant_latex=latex,
        pdf=b"%PDF...",
        page_count=page_count,
        enforced=enforced,
        iterations=1,
        tier_history=["sonnet"],
        keywords_used=["python"],
    )


def _create_master():
    cookies = _login()
    r = client.post(
        "/resumes",
        json={"name": "Master", "template_id": "jakes"},
        cookies=cookies,
    ).json()
    return cookies, r["id"]


def test_tailor_creates_variant_when_enforced():
    cookies, mid = _create_master()
    with patch(
        "app.services.jobs_runner.tailor_resume",
        new=AsyncMock(return_value=_ok_result()),
    ):
        r = client.post(
            f"/resumes/{mid}/tailor",
            cookies=cookies,
            json={"title": "SWE", "company": "Acme", "jd_text": "JD body"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["variant"]["kind"] == "variant"
    assert "Acme" in body["variant"]["name"]
    assert body["enforced"] is True
    assert body["keywords_used"] == ["python"]


def test_tailor_rejects_when_not_enforced():
    cookies, mid = _create_master()
    bad = _ok_result(enforced=False, page_count=2)
    with patch(
        "app.services.jobs_runner.tailor_resume",
        new=AsyncMock(return_value=bad),
    ):
        r = client.post(
            f"/resumes/{mid}/tailor",
            cookies=cookies,
            json={"title": "SWE", "company": "Acme", "jd_text": "JD body"},
        )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error"] == "not_one_page"
    assert detail["page_count"] == 2


def test_tailor_404_on_missing_master():
    cookies = _login()
    with patch(
        "app.services.jobs_runner.tailor_resume",
        new=AsyncMock(return_value=_ok_result()),
    ):
        r = client.post(
            "/resumes/99999/tailor",
            cookies=cookies,
            json={"title": "x", "company": "y", "jd_text": "JD"},
        )
    assert r.status_code == 404


def test_tailor_400_when_target_is_variant():
    cookies, mid = _create_master()
    with patch(
        "app.services.jobs_runner.tailor_resume",
        new=AsyncMock(return_value=_ok_result()),
    ):
        first_resp = client.post(
            f"/resumes/{mid}/tailor",
            cookies=cookies,
            json={"title": "SWE", "company": "Acme", "jd_text": "JD body"},
        )
    assert first_resp.status_code == 200
    variant_id = first_resp.json()["variant"]["id"]
    with patch(
        "app.services.jobs_runner.tailor_resume",
        new=AsyncMock(return_value=_ok_result()),
    ):
        r = client.post(
            f"/resumes/{variant_id}/tailor",
            cookies=cookies,
            json={"title": "x", "company": "y", "jd_text": "JD"},
        )
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "not_a_master_resume"


def test_tailor_requires_auth():
    r = client.post(
        "/resumes/1/tailor",
        json={"title": "x", "company": "y", "jd_text": "z"},
    )
    assert r.status_code == 401
