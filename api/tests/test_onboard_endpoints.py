from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.onboard import OnboardResult

client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _ok(latex="\\documentclass{article}\\begin{document}x\\end{document}", enforced=True, iterations=0, page_count=1):
    return OnboardResult(
        latex_source=latex,
        content_json={"header": {"name": "X"}},
        pdf=b"%PDF...",
        page_count=page_count,
        enforced=enforced,
        iterations=iterations,
    )


def test_onboard_tex_creates_master():
    cookies = _login()
    with patch("app.routes.resumes.onboard_from_latex", new=AsyncMock(return_value=_ok())):
        r = client.post("/resumes/onboard/tex", cookies=cookies, json={
            "name": "TexImport",
            "latex_source": "\\documentclass{article}\\begin{document}foo\\end{document}",
        })
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "master"
    assert body["name"] == "TexImport"
    assert body["enforced"] is True
    assert r.headers["x-page-count"] == "1"


def test_onboard_tex_persists_even_when_overflow():
    cookies = _login()
    bad = _ok(enforced=False, page_count=3, iterations=4)
    with patch("app.routes.resumes.onboard_from_latex", new=AsyncMock(return_value=bad)):
        r = client.post("/resumes/onboard/tex", cookies=cookies, json={
            "name": "BigTex",
            "latex_source": "\\documentclass{article}\\begin{document}\\end{document}",
        })
    assert r.status_code == 200
    body = r.json()
    assert body["enforced"] is False
    assert body["page_count"] == 3


def test_onboard_pdf_creates_master():
    cookies = _login()
    pdf = b"%PDF-1.4\n%%EOF\n"
    with patch("app.routes.resumes.onboard_from_pdf", new=AsyncMock(return_value=_ok())):
        r = client.post(
            "/resumes/onboard/pdf",
            cookies=cookies,
            data={"name": "PdfImport"},
            files={"file": ("resume.pdf", pdf, "application/pdf")},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "PdfImport"
    assert body["kind"] == "master"


def test_onboard_pdf_rejects_non_pdf():
    cookies = _login()
    r = client.post(
        "/resumes/onboard/pdf",
        cookies=cookies,
        data={"name": "X"},
        files={"file": ("not.pdf", b"plain text", "application/pdf")},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "not_a_pdf"


def test_onboard_tex_persists_flag_true(monkeypatch):
    cookies = _login()
    captured: dict = {}

    async def fake_enforce(**kwargs):
        captured.update(kwargs)
        from app.services.enforcer import EnforceResult
        return EnforceResult(
            latex=kwargs["candidate_latex"],
            pdf=b"%PDF...",
            page_count=1,
            overflows=[],
            enforced=True,
            iterations=0,
            tier_history=[],
        )

    monkeypatch.setattr("app.services.onboard.enforce_one_page", fake_enforce)
    r = client.post("/resumes/onboard/tex", cookies=cookies, json={
        "name": "TexFlagOn",
        "latex_source": "\\documentclass{article}\\begin{document}foo\\end{document}",
        "one_line_per_bullet": True,
    })
    assert r.status_code == 200, r.text
    assert captured.get("detect_wraps") is True
    body = r.json()
    assert body["one_line_per_bullet"] is True


def test_onboard_tex_defaults_flag_false(monkeypatch):
    cookies = _login()
    captured: dict = {}

    async def fake_enforce(**kwargs):
        captured.update(kwargs)
        from app.services.enforcer import EnforceResult
        return EnforceResult(
            latex=kwargs["candidate_latex"],
            pdf=b"%PDF...",
            page_count=1,
            overflows=[],
            enforced=True,
            iterations=0,
            tier_history=[],
        )

    monkeypatch.setattr("app.services.onboard.enforce_one_page", fake_enforce)
    r = client.post("/resumes/onboard/tex", cookies=cookies, json={
        "name": "TexFlagDefault",
        "latex_source": "\\documentclass{article}\\begin{document}foo\\end{document}",
    })
    assert r.status_code == 200, r.text
    assert captured.get("detect_wraps") is False
    body = r.json()
    assert body["one_line_per_bullet"] is False


def test_onboard_pdf_persists_flag_true(monkeypatch):
    cookies = _login()
    captured: dict = {}

    async def fake_enforce(**kwargs):
        captured.update(kwargs)
        from app.services.enforcer import EnforceResult
        return EnforceResult(
            latex=kwargs["candidate_latex"],
            pdf=b"%PDF...",
            page_count=1,
            overflows=[],
            enforced=True,
            iterations=0,
            tier_history=[],
        )

    monkeypatch.setattr("app.services.onboard.enforce_one_page", fake_enforce)
    monkeypatch.setattr("app.services.onboard.extract_pdf_text", lambda b: "")
    async def fake_map(**kwargs):
        return {"header": {"name": "X"}}
    monkeypatch.setattr("app.services.onboard.map_pdf_to_jakes_content", fake_map)
    monkeypatch.setattr("app.services.onboard.render_jakes", lambda c: "\\documentclass{article}\\begin{document}x\\end{document}")
    monkeypatch.setattr("app.services.onboard.parse_jakes", lambda l: {"header": {"name": "X"}})

    pdf = b"%PDF-1.4\n%%EOF\n"
    r = client.post(
        "/resumes/onboard/pdf",
        cookies=cookies,
        data={"name": "PdfFlagOn", "one_line_per_bullet": "true"},
        files={"file": ("resume.pdf", pdf, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    assert captured.get("detect_wraps") is True
    body = r.json()
    assert body["one_line_per_bullet"] is True


def test_onboard_pdf_defaults_flag_false(monkeypatch):
    cookies = _login()
    captured: dict = {}

    async def fake_enforce(**kwargs):
        captured.update(kwargs)
        from app.services.enforcer import EnforceResult
        return EnforceResult(
            latex=kwargs["candidate_latex"],
            pdf=b"%PDF...",
            page_count=1,
            overflows=[],
            enforced=True,
            iterations=0,
            tier_history=[],
        )

    monkeypatch.setattr("app.services.onboard.enforce_one_page", fake_enforce)
    monkeypatch.setattr("app.services.onboard.extract_pdf_text", lambda b: "")
    async def fake_map(**kwargs):
        return {"header": {"name": "X"}}
    monkeypatch.setattr("app.services.onboard.map_pdf_to_jakes_content", fake_map)
    monkeypatch.setattr("app.services.onboard.render_jakes", lambda c: "\\documentclass{article}\\begin{document}x\\end{document}")
    monkeypatch.setattr("app.services.onboard.parse_jakes", lambda l: {"header": {"name": "X"}})

    pdf = b"%PDF-1.4\n%%EOF\n"
    r = client.post(
        "/resumes/onboard/pdf",
        cookies=cookies,
        data={"name": "PdfFlagDefault"},
        files={"file": ("resume.pdf", pdf, "application/pdf")},
    )
    assert r.status_code == 200, r.text
    assert captured.get("detect_wraps") is False
    body = r.json()
    assert body["one_line_per_bullet"] is False


def test_onboard_endpoints_require_auth():
    r = client.post("/resumes/onboard/tex", json={"name": "x", "latex_source": "y"})
    assert r.status_code == 401
    r2 = client.post(
        "/resumes/onboard/pdf",
        data={"name": "x"},
        files={"file": ("a.pdf", b"%PDF", "application/pdf")},
    )
    assert r2.status_code == 401
