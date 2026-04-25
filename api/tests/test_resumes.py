from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies

def test_create_resume_from_template():
    cookies = _login()
    r = client.post("/resumes", json={"name": "My Resume", "template_id": "jakes"}, cookies=cookies)
    assert r.status_code == 201
    assert r.json()["name"] == "My Resume"
    assert "\\documentclass" in r.json()["latex_source"]

def test_list_resumes():
    cookies = _login()
    client.post("/resumes", json={"name": "R1", "template_id": "jakes"}, cookies=cookies)
    r = client.get("/resumes", cookies=cookies)
    assert r.status_code == 200
    assert len(r.json()) >= 1

def test_get_resume():
    cookies = _login()
    created = client.post("/resumes", json={"name": "R2", "template_id": "jakes"}, cookies=cookies).json()
    r = client.get(f"/resumes/{created['id']}", cookies=cookies)
    assert r.status_code == 200

def test_update_resume_latex():
    cookies = _login()
    created = client.post("/resumes", json={"name": "R3", "template_id": "jakes"}, cookies=cookies).json()
    r = client.put(f"/resumes/{created['id']}", json={"latex_source": "\\documentclass{article}\\begin{document}x\\end{document}"}, cookies=cookies)
    assert r.status_code == 200

def test_endpoints_require_auth():
    r = client.get("/resumes")
    assert r.status_code == 401


def test_grouped_returns_master_with_no_variants():
    cookies = _login()
    client.post("/resumes", json={"name": "Solo", "template_id": "jakes"}, cookies=cookies)
    r = client.get("/resumes/grouped", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert any(g["master"]["name"] == "Solo" and g["variants"] == [] for g in body)


def test_grouped_includes_variant_with_jd_info():
    from unittest.mock import patch, AsyncMock
    from app.services.tailor import TailorResult
    cookies = _login()
    master = client.post("/resumes", json={"name": "WithJD", "template_id": "jakes"}, cookies=cookies).json()
    with patch("app.routes.resumes.tailor_resume", new=AsyncMock(return_value=TailorResult(
        variant_latex="\\documentclass{article}\\begin{document}v\\end{document}",
        pdf=b"%PDF...", page_count=1, enforced=True, iterations=0,
        tier_history=[], keywords_used=["python"],
    ))):
        client.post(f"/resumes/{master['id']}/tailor", cookies=cookies, json={
            "title":"SWE","company":"Acme","jd_text":"JD body",
        })
    r = client.get("/resumes/grouped", cookies=cookies)
    assert r.status_code == 200
    group = next(g for g in r.json() if g["master"]["id"] == master["id"])
    assert len(group["variants"]) == 1
    v = group["variants"][0]
    assert v["jd_title"] == "SWE"
    assert v["jd_company"] == "Acme"


def test_grouped_requires_auth():
    r = client.get("/resumes/grouped")
    assert r.status_code == 401
