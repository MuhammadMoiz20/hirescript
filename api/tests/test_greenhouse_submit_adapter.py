"""Behavioral tests for the Greenhouse Playwright submit adapter.

The adapter is exercised against static HTML fixtures served from a local
threaded HTTP server. Playwright drives a real headless Chromium — these
tests fail to import (and therefore skip) if Playwright + Chromium aren't
installed, which keeps the dev-loop fast on hosts without the browser stack.
"""

from __future__ import annotations

import socket
import threading
import time
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import pytest


_FIXTURE_DIR = Path(__file__).parent / "fixtures"


_playwright_available = True
try:  # pragma: no cover — import smoke
    import playwright  # noqa: F401
except Exception:  # pragma: no cover — playwright not in image
    _playwright_available = False


pytestmark = pytest.mark.skipif(
    not _playwright_available,
    reason="playwright (chromium) not installed in this image",
)


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class _FixtureHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, **kwargs) -> None:
        super().__init__(*args, directory=directory or str(_FIXTURE_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # Silence default request logging — keeps test output clean.
        return


class _FixtureServer:
    def __init__(self) -> None:
        self.port = _free_port()
        self.host = "127.0.0.1"
        self.httpd = HTTPServer((self.host, self.port), _FixtureHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> "_FixtureServer":
        self.thread.start()
        # Tiny readiness wait — the bind is already done so this is just for
        # the serve_forever loop to enter.
        time.sleep(0.05)
        return self

    def url(self, path: str) -> str:
        return f"http://{self.host}:{self.port}/{path.lstrip('/')}"

    def __exit__(self, *exc) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def _write_fake_pdf(tmp_path: Path) -> Path:
    # Tiny valid-ish PDF header. The Greenhouse fixture doesn't care about
    # PDF structure — it only needs a file the file-input can attach.
    p = tmp_path / "resume.pdf"
    p.write_bytes(b"%PDF-1.4\n%fake\n%%EOF\n")
    return p


def _ctx(tmp_path: Path, server: _FixtureServer, *, fixture: str) -> dict:
    return {
        "application_id": 42,
        "posting_apply_url": server.url(fixture),
        "profile_first_name": "Moiz",
        "profile_last_name": "Zahid",
        "profile_email": "moiz@example.com",
        "profile_phone": "+15555550100",
        "profile_links": {
            "linkedin": "https://linkedin.com/in/moiz",
            "github": "https://github.com/moiz",
            "site": "https://moiz.dev",
        },
        "resume_pdf_path": str(_write_fake_pdf(tmp_path)),
        "cover_letter_text": "Dear Hiring Manager, I am excited to apply...",
        "form_payload": {"How did you hear about us?": "From a friend"},
    }


@pytest.mark.asyncio
async def test_greenhouse_submit_fills_form_and_captures_confirmation(
    tmp_path,
):
    from app.services.submit_adapters import greenhouse

    with _FixtureServer() as server:
        ctx = _ctx(tmp_path, server, fixture="greenhouse_form.html")
        result = await greenhouse.submit(
            ctx,  # type: ignore[arg-type]
            screenshot_dir=str(tmp_path / "shots"),
        )

    assert "Thank you" in result["confirmation_html"]
    shot = Path(result["confirmation_screenshot_path"])
    assert shot.exists() and shot.stat().st_size > 0
    delta = datetime.now(timezone.utc) - result["submitted_at"]
    assert delta.total_seconds() < 60


@pytest.mark.asyncio
async def test_greenhouse_submit_raises_on_missing_required_field(tmp_path):
    from app.services.submit_adapters import greenhouse

    with _FixtureServer() as server:
        ctx = _ctx(
            tmp_path, server, fixture="greenhouse_form_missing_email.html"
        )
        with pytest.raises(greenhouse.MissingFieldError) as excinfo:
            await greenhouse.submit(
                ctx,  # type: ignore[arg-type]
                screenshot_dir=str(tmp_path / "shots"),
            )

    assert excinfo.value.field == "email"


@pytest.mark.asyncio
async def test_greenhouse_submit_emits_progress_events(tmp_path):
    from app.services.submit_adapters import greenhouse

    events: list[dict] = []

    async def on_progress(ev: dict) -> None:
        events.append(ev)

    with _FixtureServer() as server:
        ctx = _ctx(tmp_path, server, fixture="greenhouse_form.html")
        await greenhouse.submit(
            ctx,  # type: ignore[arg-type]
            on_progress=on_progress,
            screenshot_dir=str(tmp_path / "shots"),
        )

    phases = [e["phase"] for e in events]
    assert "nav_to_form" in phases
    assert "filling_field" in phases
    assert "uploaded_resume" in phases
    assert "submitting" in phases
    assert "confirmed" in phases
