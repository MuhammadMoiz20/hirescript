"""Tests verifying mutation endpoints insert a ResumeVersion row."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models import ResumeVersion
from app.services.compile import CompileResult
from app.services.onboard import OnboardResult
from app.services.tailor import TailorResult


client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _ok_compile(page_count: int = 1) -> CompileResult:
    return CompileResult(pdf=b"%PDF-1.4\n", page_count=page_count)


async def _versions_for(resume_id: int):
    async with SessionLocal() as s:
        rows = (
            await s.execute(
                select(ResumeVersion)
                .where(ResumeVersion.resume_id == resume_id)
                .order_by(ResumeVersion.id)
            )
        ).scalars().all()
        return rows


async def test_manual_save_creates_version():
    cookies = _login()
    rid = client.post(
        "/resumes", json={"name": "V", "template_id": "jakes"}, cookies=cookies
    ).json()["id"]
    r = client.put(
        f"/resumes/{rid}",
        cookies=cookies,
        json={
            "latex_source": "\\documentclass{article}\\begin{document}m\\end{document}"
        },
    )
    assert r.status_code == 200
    versions = await _versions_for(rid)
    assert any(v.edit_source == "manual" for v in versions)


async def test_accept_edit_creates_version():
    cookies = _login()
    rid = client.post(
        "/resumes", json={"name": "V2", "template_id": "jakes"}, cookies=cookies
    ).json()["id"]
    with patch(
        "app.routes.resumes.compile_latex", return_value=_ok_compile(page_count=1)
    ):
        r = client.post(
            f"/resumes/{rid}/edits/accept",
            cookies=cookies,
            json={
                "proposed_latex": "\\documentclass{article}\\begin{document}p\\end{document}",
            },
        )
        assert r.status_code == 200
    versions = await _versions_for(rid)
    assert any(v.edit_source == "ai_chat" and v.page_count == 1 for v in versions)


async def test_section_save_creates_version():
    cookies = _login()
    rid = client.post(
        "/resumes", json={"name": "V3", "template_id": "jakes"}, cookies=cookies
    ).json()["id"]
    body = client.get(f"/resumes/{rid}/sections", cookies=cookies).json()["content_json"]
    with patch(
        "app.routes.resumes.compile_latex", return_value=_ok_compile(page_count=1)
    ):
        r = client.put(
            f"/resumes/{rid}/sections",
            cookies=cookies,
            json={"content_json": body},
        )
        assert r.status_code == 200
    versions = await _versions_for(rid)
    assert any(v.edit_source == "section_form" for v in versions)


async def test_tailor_creates_version_for_variant():
    cookies = _login()
    rid = client.post(
        "/resumes", json={"name": "V4", "template_id": "jakes"}, cookies=cookies
    ).json()["id"]
    fake = TailorResult(
        variant_latex="\\documentclass{article}\\begin{document}t\\end{document}",
        pdf=b"%PDF-1.4\n",
        page_count=1,
        enforced=True,
        iterations=1,
        tier_history=["sonnet"],
        keywords_used=["python"],
    )
    with patch(
        "app.routes.resumes.tailor_resume", new=AsyncMock(return_value=fake)
    ):
        r = client.post(
            f"/resumes/{rid}/tailor",
            cookies=cookies,
            json={
                "title": "SWE",
                "company": "Acme",
                "jd_text": "JD body",
            },
        )
        assert r.status_code == 200
    variant_id = r.json()["variant"]["id"]
    versions = await _versions_for(variant_id)
    assert any(
        v.edit_source == "ai_tailor" and "Acme" in (v.edit_prompt or "")
        for v in versions
    )


async def test_onboard_tex_creates_version():
    cookies = _login()
    fake = OnboardResult(
        latex_source="\\documentclass{article}\\begin{document}o\\end{document}",
        content_json={"header": {"name": "X"}},
        pdf=b"%PDF-1.4\n",
        page_count=1,
        enforced=True,
        iterations=0,
    )
    with patch(
        "app.routes.resumes.onboard_from_latex", new=AsyncMock(return_value=fake)
    ):
        r = client.post(
            "/resumes/onboard/tex",
            cookies=cookies,
            json={
                "name": "OB",
                "latex_source": "\\documentclass{article}\\begin{document}o\\end{document}",
            },
        )
        assert r.status_code == 200
    rid = r.json()["id"]
    versions = await _versions_for(rid)
    assert any(v.edit_source == "onboard" for v in versions)
