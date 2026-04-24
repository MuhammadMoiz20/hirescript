from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def test_list_versions_empty_then_populated():
    cookies = _login()
    rid = client.post(
        "/resumes",
        json={"name": "L", "template_id": "jakes"},
        cookies=cookies,
    ).json()["id"]
    r = client.get(f"/resumes/{rid}/versions", cookies=cookies)
    assert r.status_code == 200
    assert r.json() == []
    client.put(
        f"/resumes/{rid}",
        cookies=cookies,
        json={
            "latex_source": "\\documentclass{article}\\begin{document}m\\end{document}"
        },
    )
    r2 = client.get(f"/resumes/{rid}/versions", cookies=cookies)
    rows = r2.json()
    assert len(rows) >= 1
    assert rows[0]["edit_source"] == "manual"


def test_get_version_returns_detail():
    cookies = _login()
    rid = client.post(
        "/resumes",
        json={"name": "D", "template_id": "jakes"},
        cookies=cookies,
    ).json()["id"]
    client.put(
        f"/resumes/{rid}",
        cookies=cookies,
        json={
            "latex_source": "\\documentclass{article}\\begin{document}body1\\end{document}"
        },
    )
    listing = client.get(f"/resumes/{rid}/versions", cookies=cookies).json()
    vid = listing[0]["id"]
    r = client.get(f"/resumes/{rid}/versions/{vid}", cookies=cookies)
    assert r.status_code == 200
    assert "latex_source" in r.json()
    assert r.json()["resume_id"] == rid


def test_rollback_restores_latex_and_creates_new_version():
    cookies = _login()
    rid = client.post(
        "/resumes",
        json={"name": "R", "template_id": "jakes"},
        cookies=cookies,
    ).json()["id"]
    client.put(
        f"/resumes/{rid}",
        cookies=cookies,
        json={
            "latex_source": "\\documentclass{article}\\begin{document}V1\\end{document}"
        },
    )
    client.put(
        f"/resumes/{rid}",
        cookies=cookies,
        json={
            "latex_source": "\\documentclass{article}\\begin{document}V2\\end{document}"
        },
    )
    versions = client.get(f"/resumes/{rid}/versions", cookies=cookies).json()
    v1_id = versions[-1]["id"]
    r = client.post(
        f"/resumes/{rid}/versions/{v1_id}/rollback", cookies=cookies
    )
    assert r.status_code == 200
    assert "V1" in r.json()["latex_source"]
    versions2 = client.get(f"/resumes/{rid}/versions", cookies=cookies).json()
    assert any(
        v["edit_source"] == "rollback"
        and (v["edit_prompt"] or "").startswith("to v")
        for v in versions2
    )


def test_versions_404_on_other_user_resume():
    cookies = _login()
    r = client.get("/resumes/999999/versions", cookies=cookies)
    assert r.status_code == 404


def test_versions_require_auth():
    client.cookies.clear()
    r = client.get("/resumes/1/versions")
    assert r.status_code == 401
