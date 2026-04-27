"""Behavioral tests for the browser-agent submit fallback.

The Claude SDK is mocked via ``_query_agent_plan``; Playwright is mocked
via a fake ``async_playwright`` factory that records every tool call and
asserts no final-submit click ever fires.
"""

from __future__ import annotations

import pytest

from app.services.submit_adapters import agent_submit


class _FakeLocator:
    def __init__(self, page: "_FakePage", selector: str) -> None:
        self.page = page
        self.selector = selector

    @property
    def first(self) -> "_FakeLocator":
        return self

    async def click(self) -> None:
        self.page.calls.append(("click", self.selector))

    async def fill(self, value: str) -> None:
        self.page.calls.append(("fill", self.selector, value))

    async def set_input_files(self, path: str) -> None:
        self.page.calls.append(("set_input_files", self.selector, path))


class _FakePage:
    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.url = ""

    async def goto(self, url: str, timeout: int | None = None) -> None:
        self.calls.append(("goto", url))
        self.url = url

    async def title(self) -> str:
        return "Apply"

    async def evaluate(self, script: str) -> str:
        return "snapshot text"

    def locator(self, sel: str) -> _FakeLocator:
        return _FakeLocator(self, sel)

    async def screenshot(self, *, path: str, full_page: bool = True) -> None:
        # Write a tiny stub PNG so the test can assert the file exists.
        with open(path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\nfake")
        self.calls.append(("screenshot", path))


class _FakeContext:
    def __init__(self, page: _FakePage) -> None:
        self._page = page

    async def new_page(self) -> _FakePage:
        return self._page


class _FakeBrowser:
    def __init__(self, page: _FakePage) -> None:
        self._page = page
        self.closed = False

    async def new_context(self) -> _FakeContext:
        return _FakeContext(self._page)

    async def close(self) -> None:
        self.closed = True


class _FakeChromium:
    def __init__(self, page: _FakePage) -> None:
        self._page = page

    async def launch(self, headless: bool = True) -> _FakeBrowser:
        return _FakeBrowser(self._page)


class _FakePlaywright:
    def __init__(self, page: _FakePage) -> None:
        self.chromium = _FakeChromium(page)


class _FakePlaywrightCtx:
    def __init__(self, page: _FakePage) -> None:
        self._pw = _FakePlaywright(page)

    async def __aenter__(self) -> _FakePlaywright:
        return self._pw

    async def __aexit__(self, *exc) -> None:
        return None


def _patch_playwright(monkeypatch, page: _FakePage) -> None:
    """Replace `playwright.async_api.async_playwright` with our fake."""
    import playwright.async_api

    monkeypatch.setattr(
        playwright.async_api,
        "async_playwright",
        lambda: _FakePlaywrightCtx(page),
    )


def _ctx(tmp_path) -> dict:
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n%fake\n%%EOF\n")
    return {
        "application_id": 123,
        "posting_apply_url": "https://unknown-ats.example/jobs/9",
        "profile_first_name": "Moiz",
        "profile_last_name": "Zahid",
        "profile_email": "moiz@example.com",
        "profile_phone": "+15555550100",
        "profile_links": {
            "linkedin": "https://linkedin.com/in/moiz",
            "github": "https://github.com/moiz",
        },
        "resume_pdf_path": str(pdf),
        "jd_excerpt": "We do distributed systems.",
        "form_payload": {},
    }


@pytest.mark.asyncio
async def test_agent_submit_executes_plan_and_pauses_for_confirmation(
    monkeypatch, tmp_path,
):
    """The mocked SDK returns a tool-call sequence ending in
    awaiting_user_confirmation. Assert: each tool ran against the page,
    no final-submit click happened, the result carries
    awaiting_user_confirmation=True + a screenshot path that exists."""
    page = _FakePage()
    _patch_playwright(monkeypatch, page)

    plan = {
        "actions": [
            {"tool": "navigate", "params": {"url": "https://unknown-ats.example/jobs/9"}},
            {"tool": "fill", "params": {"selector": "input[name='name']", "value": "Moiz Zahid"}},
            {"tool": "fill", "params": {"selector": "input[name='email']", "value": "moiz@example.com"}},
            {"tool": "upload", "params": {"selector": "input[type=file]", "path": _ctx(tmp_path)["resume_pdf_path"]}},
            {"tool": "screenshot", "params": {"path": str(tmp_path / "midway.png")}},
        ],
        "final": {
            "action": "awaiting_user_confirmation",
            "screenshot_path": str(tmp_path / "pause.png"),
            "form_summary": "Filled name + email + uploaded resume; awaiting submit.",
        },
    }

    async def fake_query_agent_plan(**kwargs):
        return plan

    monkeypatch.setattr(
        agent_submit, "_query_agent_plan", fake_query_agent_plan
    )

    events: list[dict] = []

    async def on_progress(ev: dict) -> None:
        events.append(ev)

    result = await agent_submit.run(
        _ctx(tmp_path),
        on_progress=on_progress,
        screenshot_dir=str(tmp_path / "shots"),
    )

    assert result["awaiting_user_confirmation"] is True
    assert result["agent_session_id"]
    assert "Filled name + email" in result["form_summary"]
    # Pause screenshot must exist and contain real bytes.
    pause = result["screenshot_path"]
    import os
    assert os.path.exists(pause) and os.path.getsize(pause) > 0

    # The page recorded the tool calls.
    tool_kinds = [c[0] for c in page.calls]
    assert "goto" in tool_kinds
    assert "fill" in tool_kinds
    assert "set_input_files" in tool_kinds

    # CRITICAL: no click ever fired (no final-submit slip).
    assert "click" not in tool_kinds

    # Progress events surface the agent lifecycle.
    phases = [e["phase"] for e in events]
    assert "agent_started" in phases
    assert "agent_tool_call" in phases
    assert "agent_awaiting_user_confirmation" in phases


@pytest.mark.asyncio
async def test_agent_submit_refuses_envelope_without_pause_action(
    monkeypatch, tmp_path,
):
    """If the model omits the awaiting_user_confirmation final action,
    the agent run must abort — never submit silently."""
    page = _FakePage()
    _patch_playwright(monkeypatch, page)

    bad_plan = {
        "actions": [
            {"tool": "navigate", "params": {"url": "https://x.example"}},
        ],
        "final": {"action": "submitted"},
    }

    async def fake_query_agent_plan(**kwargs):
        return bad_plan

    monkeypatch.setattr(
        agent_submit, "_query_agent_plan", fake_query_agent_plan
    )

    with pytest.raises(RuntimeError, match="awaiting_user_confirmation"):
        await agent_submit.run(_ctx(tmp_path))


@pytest.mark.asyncio
async def test_agent_tools_click_refuses_final_submit_selectors(
    monkeypatch, tmp_path,
):
    """The click tool refuses any selector that looks like a final-submit
    button. The agent loop catches the refusal as an ok=False result and
    moves on — no submission is fired."""
    from app.services.submit_adapters import agent_tools

    page = _FakePage()
    out = await agent_tools.click(page, {"selector": "button[type='submit']"})
    assert out["ok"] is False
    assert "refused" in out["error"]
    # The page recorded NO click.
    assert ("click", "button[type='submit']") not in page.calls
