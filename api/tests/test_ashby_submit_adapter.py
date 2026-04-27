"""Behavioral tests for the Ashby Playwright submit adapter.

Mirrors ``test_greenhouse_submit_adapter.py``. The Ashby fixture mounts the
form on a 50ms delay to exercise the client-side render path.
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
try:  # pragma: no cover
    import playwright  # noqa: F401
except Exception:  # pragma: no cover
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
        return


class _FixtureServer:
    def __init__(self) -> None:
        self.port = _free_port()
        self.host = "127.0.0.1"
        self.httpd = HTTPServer((self.host, self.port), _FixtureHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> "_FixtureServer":
        self.thread.start()
        time.sleep(0.05)
        return self

    def url(self, path: str) -> str:
        return f"http://{self.host}:{self.port}/{path.lstrip('/')}"

    def __exit__(self, *exc) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def _write_fake_pdf(tmp_path: Path) -> Path:
    p = tmp_path / "resume.pdf"
    p.write_bytes(b"%PDF-1.4\n%fake\n%%EOF\n")
    return p


def _ctx(tmp_path: Path, server: _FixtureServer, *, fixture: str) -> dict:
    return {
        "application_id": 88,
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
        "cover_letter_text": "",
        "form_payload": {},
    }


@pytest.mark.asyncio
async def test_ashby_submit_fills_form_and_captures_confirmation(tmp_path):
    from app.services.submit_adapters import ashby

    with _FixtureServer() as server:
        ctx = _ctx(tmp_path, server, fixture="ashby_apply.html")
        result = await ashby.submit(
            ctx,  # type: ignore[arg-type]
            screenshot_dir=str(tmp_path / "shots"),
        )

    assert "Application submitted" in result["confirmation_html"]
    shot = Path(result["confirmation_screenshot_path"])
    assert shot.exists() and shot.stat().st_size > 0
    delta = datetime.now(timezone.utc) - result["submitted_at"]
    assert delta.total_seconds() < 60


@pytest.mark.asyncio
async def test_ashby_submit_emits_progress_events(tmp_path):
    from app.services.submit_adapters import ashby

    events: list[dict] = []

    async def on_progress(ev: dict) -> None:
        events.append(ev)

    with _FixtureServer() as server:
        ctx = _ctx(tmp_path, server, fixture="ashby_apply.html")
        await ashby.submit(
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


@pytest.mark.asyncio
async def test_ashby_submit_raises_on_missing_required_field(tmp_path):
    """An Ashby form missing the email field must raise MissingFieldError."""
    from app.services.submit_adapters import ashby, greenhouse

    with _FixtureServer() as server:
        ctx = _ctx(tmp_path, server, fixture="ashby_apply_missing_email.html")
        with pytest.raises(greenhouse.MissingFieldError) as excinfo:
            await ashby.submit(
                ctx,  # type: ignore[arg-type]
                screenshot_dir=str(tmp_path / "shots"),
            )

    assert excinfo.value.field == "email"


def test_ashby_registered_in_adapters_registry():
    from app.services.submit_adapters import ashby
    from app.services.submit_adapters.registry import ADAPTERS

    assert ADAPTERS["ashby"] is ashby
