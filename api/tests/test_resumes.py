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
    with patch("app.services.jobs_runner.tailor_resume", new=AsyncMock(return_value=TailorResult(
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


def test_delete_resume_without_variants():
    cookies = _login()
    created = client.post("/resumes", json={"name": "ToDelete", "template_id": "jakes"}, cookies=cookies).json()
    r = client.delete(f"/resumes/{created['id']}", cookies=cookies)
    assert r.status_code == 204
    assert client.get(f"/resumes/{created['id']}", cookies=cookies).status_code == 404


def test_delete_master_with_variants_requires_promote():
    from unittest.mock import patch, AsyncMock
    from app.services.tailor import TailorResult
    cookies = _login()
    master = client.post("/resumes", json={"name": "Mstr", "template_id": "jakes"}, cookies=cookies).json()
    with patch("app.services.jobs_runner.tailor_resume", new=AsyncMock(return_value=TailorResult(
        variant_latex="\\documentclass{article}\\begin{document}v\\end{document}",
        pdf=b"%PDF...", page_count=1, enforced=True, iterations=0,
        tier_history=[], keywords_used=[],
    ))):
        client.post(f"/resumes/{master['id']}/tailor", cookies=cookies, json={
            "title": "T", "company": "C", "jd_text": "JD",
        })
    r = client.delete(f"/resumes/{master['id']}", cookies=cookies)
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "promote_required"
    assert len(r.json()["detail"]["variant_ids"]) == 1


def test_delete_master_promotes_variant():
    from unittest.mock import patch, AsyncMock
    from app.services.tailor import TailorResult
    cookies = _login()
    master = client.post("/resumes", json={"name": "Mstr2", "template_id": "jakes"}, cookies=cookies).json()
    with patch("app.services.jobs_runner.tailor_resume", new=AsyncMock(return_value=TailorResult(
        variant_latex="\\documentclass{article}\\begin{document}v\\end{document}",
        pdf=b"%PDF...", page_count=1, enforced=True, iterations=0,
        tier_history=[], keywords_used=[],
    ))):
        for c in ("Acme", "Beta"):
            client.post(f"/resumes/{master['id']}/tailor", cookies=cookies, json={
                "title": "T", "company": c, "jd_text": "JD",
            })
    grouped = client.get("/resumes/grouped", cookies=cookies).json()
    grp = next(g for g in grouped if g["master"]["id"] == master["id"])
    variant_ids = [v["id"] for v in grp["variants"]]
    promote = variant_ids[0]
    other = variant_ids[1]
    r = client.delete(f"/resumes/{master['id']}?promote={promote}", cookies=cookies)
    assert r.status_code == 204
    assert client.get(f"/resumes/{master['id']}", cookies=cookies).status_code == 404
    new_master = client.get(f"/resumes/{promote}", cookies=cookies).json()
    assert new_master["kind"] == "master"
    grouped2 = client.get("/resumes/grouped", cookies=cookies).json()
    new_grp = next(g for g in grouped2 if g["master"]["id"] == promote)
    assert other in [v["id"] for v in new_grp["variants"]]


def test_duplicate_resume():
    cookies = _login()
    src = client.post("/resumes", json={"name": "Orig", "template_id": "jakes"}, cookies=cookies).json()
    r = client.post(f"/resumes/{src['id']}/duplicate", cookies=cookies)
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Orig (copy)"
    assert body["kind"] == "master"
    assert body["id"] != src["id"]


def test_get_jd():
    from unittest.mock import patch, AsyncMock
    from app.services.tailor import TailorResult
    cookies = _login()
    master = client.post("/resumes", json={"name": "JDR", "template_id": "jakes"}, cookies=cookies).json()
    with patch("app.services.jobs_runner.tailor_resume", new=AsyncMock(return_value=TailorResult(
        variant_latex="\\documentclass{article}\\begin{document}v\\end{document}",
        pdf=b"%PDF...", page_count=1, enforced=True, iterations=0,
        tier_history=[], keywords_used=[],
    ))):
        resp = client.post(f"/resumes/{master['id']}/tailor", cookies=cookies, json={
            "title": "SWE", "company": "Acme", "url": "https://x.test/job",
            "jd_text": "We need engineers",
        })
    assert resp.status_code == 200
    jd_id = resp.json()["jd_id"]
    assert jd_id is not None
    r = client.get(f"/jds/{jd_id}", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "SWE"
    assert body["company"] == "Acme"
    assert body["url"] == "https://x.test/job"
    assert body["raw_text"] == "We need engineers"


def test_get_jd_requires_auth():
    r = client.get("/jds/1")
    assert r.status_code == 401


def test_compile_returns_overflow_count_header():
    cookies = _login()
    created = client.post("/resumes", json={"name": "Comp", "template_id": "jakes"}, cookies=cookies).json()
    r = client.post(f"/resumes/{created['id']}/compile", cookies=cookies)
    assert r.status_code == 200
    assert "x-overflow-count" in (k.lower() for k in r.headers.keys())
    assert int(r.headers["x-overflow-count"]) >= 0


def test_repair_endpoint_returns_envelope():
    """The repair endpoint runs the enforcer and returns the cleaned source.
    With a clean Jake's template seed and mocked repair_overflow (so we don't
    hit the real model), the enforcer should short-circuit on iteration 0
    when the doc is already clean."""
    from unittest.mock import patch, AsyncMock
    cookies = _login()
    created = client.post("/resumes", json={"name": "Rep", "template_id": "jakes"}, cookies=cookies).json()
    # Stub repair_overflow so even if compile reports overflows we don't call
    # the model in tests; the enforcer never reaches it for a clean template.
    with patch("app.services.enforcer.repair_overflow", new=AsyncMock()):
        r = client.post(f"/resumes/{created['id']}/repair", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert "latex_source" in body
    assert "page_count" in body
    assert "overflow_count" in body
    assert "enforced" in body
    assert "iterations" in body
