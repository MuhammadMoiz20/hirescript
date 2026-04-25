"""Tests for chat-edit propose/accept endpoints.

Mocks agent, enforcer, and compile so no real model or Tectonic calls occur.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.compile import CompileError, CompileResult
from app.services.enforcer import EnforceResult


client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


def _create_resume(cookies):
    return client.post(
        "/resumes",
        json={"name": "EditResume", "template_id": "jakes"},
        cookies=cookies,
    ).json()


async def _async_gen(chunks):
    for c in chunks:
        yield c


def _parse_sse(body: str):
    """Parse raw SSE body into list of (event, data) tuples."""
    events = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = None
        data = None
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data = line[len("data:"):].strip()
        if event is not None:
            events.append((event, data))
    return events


def test_edit_endpoint_streams_chunks_then_result():
    cookies = _login()
    resume = _create_resume(cookies)

    # Stream conversational tokens followed by the JSON envelope the route now expects.
    fake_edit = MagicMock(
        return_value=_async_gen([
            "abc",
            "def",
            '\n```json\n{"latex": "REVISED-DOC", "rationale": "ok"}\n```',
        ])
    )
    fake_enforce = AsyncMock(
        return_value=EnforceResult(
            latex="final latex",
            pdf=b"%PDF",
            page_count=1,
            iterations=0,
            enforced=True,
            tier_history=[],
            log=[],
        )
    )
    fake_compile = MagicMock(
        return_value=CompileResult(pdf=b"%PDF", page_count=1)
    )

    with patch("app.routes.resumes.edit_resume", fake_edit), patch(
        "app.routes.resumes.enforce_one_page", fake_enforce
    ), patch("app.routes.resumes.compile_latex", fake_compile):
        r = client.post(
            f"/resumes/{resume['id']}/edits",
            json={"instruction": "make it punchier"},
            cookies=cookies,
        )

    assert r.status_code == 200
    events = _parse_sse(r.text)
    assert len(events) >= 3
    assert events[0][0] == "chunk"
    assert '"text": "abc"' in events[0][1]
    assert events[1][0] == "chunk"
    assert '"text": "def"' in events[1][1]
    assert events[-1][0] == "result"
    import json as _json
    final = _json.loads(events[-1][1])
    assert final["enforced"] is True
    assert final["page_count"] == 1
    assert final["proposed_latex"] == "final latex"


def test_edit_endpoint_requires_auth():
    r = client.post(
        "/resumes/1/edits",
        json={"instruction": "hi"},
    )
    assert r.status_code in (401, 404)


def test_edit_endpoint_404_on_missing_resume():
    cookies = _login()
    r = client.post(
        "/resumes/999999/edits",
        json={"instruction": "hi"},
        cookies=cookies,
    )
    assert r.status_code == 404


def test_accept_persists_when_one_page():
    cookies = _login()
    resume = _create_resume(cookies)
    new_latex = "\\documentclass{article}\\begin{document}accepted\\end{document}"

    fake_compile = MagicMock(
        return_value=CompileResult(pdf=b"%PDF", page_count=1)
    )
    with patch("app.routes.resumes.compile_latex", fake_compile):
        r = client.post(
            f"/resumes/{resume['id']}/edits/accept",
            json={"proposed_latex": new_latex},
            cookies=cookies,
        )

    assert r.status_code == 200
    assert r.headers.get("x-page-count") == "1"
    body = r.json()
    assert body["id"] == resume["id"]
    assert body["latex_source"] == new_latex

    # Verify persisted via GET
    got = client.get(f"/resumes/{resume['id']}", cookies=cookies).json()
    assert got["latex_source"] == new_latex


def test_accept_rejects_when_multi_page():
    cookies = _login()
    resume = _create_resume(cookies)
    original = client.get(f"/resumes/{resume['id']}", cookies=cookies).json()[
        "latex_source"
    ]

    fake_compile = MagicMock(
        return_value=CompileResult(pdf=b"%PDF", page_count=2)
    )
    with patch("app.routes.resumes.compile_latex", fake_compile):
        r = client.post(
            f"/resumes/{resume['id']}/edits/accept",
            json={"proposed_latex": "longer latex"},
            cookies=cookies,
        )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error"] == "not_one_page"
    assert detail["page_count"] == 2

    # ensure not persisted
    got = client.get(f"/resumes/{resume['id']}", cookies=cookies).json()
    assert got["latex_source"] == original


def test_accept_rejects_on_compile_error():
    cookies = _login()
    resume = _create_resume(cookies)

    fake_compile = MagicMock(side_effect=CompileError("tex failure"))
    with patch("app.routes.resumes.compile_latex", fake_compile):
        r = client.post(
            f"/resumes/{resume['id']}/edits/accept",
            json={"proposed_latex": "\\bad"},
            cookies=cookies,
        )
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "compile_failed"


def test_accept_requires_auth():
    r = client.post(
        "/resumes/1/edits/accept",
        json={"proposed_latex": "x"},
    )
    assert r.status_code in (401, 404)
