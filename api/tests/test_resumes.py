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
