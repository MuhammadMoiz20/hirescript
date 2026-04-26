"""Tests for the onboarding interview agent + route.

We mock ``claude_agent_sdk.query`` (imported into ``app.services.onboarding``)
so no real model calls occur. Voyage embeddings are stubbed too — the only
``add_kb_note`` test would otherwise hit the real embedding API.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import delete
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import KbChunk, KbDocument, Profile as ProfileModel
from app.services import kb_ingest


client = TestClient(app)


def _login():
    return client.post("/auth/login", json={"password": "changeme"}).cookies


@pytest.fixture(autouse=True)
async def _clean_state():
    async with SessionLocal() as s:
        await s.execute(delete(KbChunk))
        await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
        await s.execute(delete(ProfileModel).where(ProfileModel.user_id == 1))
        await s.commit()
    yield
    async with SessionLocal() as s:
        await s.execute(delete(KbChunk))
        await s.execute(delete(KbDocument).where(KbDocument.user_id == 1))
        await s.execute(delete(ProfileModel).where(ProfileModel.user_id == 1))
        await s.commit()


@pytest.fixture(autouse=True)
def _stub_embed(monkeypatch):
    async def fake_embed(texts):
        return [[0.0] * 1024 for _ in texts]

    monkeypatch.setattr(kb_ingest, "embed", fake_embed)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeAsyncIter:
    def __init__(self, items):
        self.items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.items:
            raise StopAsyncIteration
        return self.items.pop(0)


def _assistant_message(*blocks):
    from claude_agent_sdk import AssistantMessage

    return AssistantMessage(
        content=list(blocks),
        model="test-model",
        parent_tool_use_id=None,
        error=None,
        usage=None,
        message_id="m-1",
        stop_reason=None,
        session_id="s-1",
        uuid="u-1",
    )


def _text(t):
    from claude_agent_sdk import TextBlock

    return TextBlock(text=t)


def _tool_use(name, input_):
    from claude_agent_sdk import ToolUseBlock

    return ToolUseBlock(id=f"t-{name}", name=name, input=input_)


def _parse_sse(body: str):
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_onboarding_message_persists_profile_update():
    cookies = _login()
    msgs = [
        _assistant_message(
            _tool_use(
                "update_profile_fields",
                {"patch": {"legal_name": "Moiz", "email": "m@x.com"}},
            ),
        ),
        _assistant_message(_text("Got it, recorded those.")),
    ]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch("app.services.onboarding.query", fake_query):
        r = client.post(
            "/onboarding/message",
            json={"message": "I'm Moiz, m@x.com.", "history": []},
            cookies=cookies,
        )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    names = [e for e, _ in events]
    assert "tool_use" in names
    assert "tool_result" in names
    assert "text" in names
    assert "done" in names
    # Final assistant text rendered
    text_events = [d for n, d in events if n == "text"]
    assert any('"text":' in d and "Got it" in d for d in text_events)

    # Verify profile persisted
    p = client.get("/profile", cookies=cookies).json()
    assert p["legal_name"] == "Moiz"
    assert p["email"] == "m@x.com"


def test_onboarding_message_creates_kb_note():
    cookies = _login()
    msgs = [
        _assistant_message(
            _tool_use(
                "add_kb_note",
                {
                    "title": "Why I left CompanyX",
                    "body": "Some narrative answer.",
                },
            ),
        ),
        _assistant_message(_text("Saved.")),
    ]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch("app.services.onboarding.query", fake_query):
        r = client.post(
            "/onboarding/message",
            json={"message": "I left because…", "history": []},
            cookies=cookies,
        )
    assert r.status_code == 200

    docs = client.get(
        "/kb/documents", params={"source": "onboarding"}, cookies=cookies
    ).json()
    assert docs["total"] == 1
    assert docs["items"][0]["title"] == "Why I left CompanyX"
    assert docs["items"][0]["source"] == "onboarding"


def test_onboarding_rejects_invalid_profile_patch():
    cookies = _login()
    # Seed a valid profile first so we can prove it didn't get clobbered.
    client.put(
        "/profile",
        json={"legal_name": "Moiz", "email": "good@example.com"},
        cookies=cookies,
    )

    msgs = [
        _assistant_message(
            _tool_use(
                "update_profile_fields",
                {"patch": {"email": "not-an-email"}},
            ),
        ),
        _assistant_message(_text("Sorry, that email looked invalid.")),
    ]
    fake_query = MagicMock(return_value=_FakeAsyncIter(msgs))
    with patch("app.services.onboarding.query", fake_query):
        r = client.post(
            "/onboarding/message",
            json={"message": "my email is not-an-email", "history": []},
            cookies=cookies,
        )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    names = [e for e, _ in events]
    assert "tool_error" in names

    # Profile email must be unchanged
    p = client.get("/profile", cookies=cookies).json()
    assert p["email"] == "good@example.com"
