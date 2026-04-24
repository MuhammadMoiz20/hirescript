from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_compile_endpoint_returns_pdf():
    cookies = client.post("/auth/login", json={"password": "changeme"}).cookies
    created = client.post("/resumes", json={"name": "RC", "template_id": "jakes"}, cookies=cookies).json()
    r = client.post(f"/resumes/{created['id']}/compile", cookies=cookies)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"
