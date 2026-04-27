"""Tests for the Gmail digest source.

The module has three concerns we exercise independently:

1. ``fetch_unread_emails`` (IMAP poll) — we don't try to mock
   ``aioimaplib`` end-to-end (it's gnarly); instead we monkeypatch the
   helper directly to return a fixture list, since the orchestrator
   calls it through the module name.
2. ``extract_postings`` (Haiku call) — mocked via the same
   ``get_api_client`` pattern as :mod:`test_verify`.
3. ``poll_and_ingest`` — the orchestrator. Asserts: zero-postings
   email is a no-op; multi-posting email creates multiple rows;
   duplicate apply_url across runs collapses via the upsert;
   ``meta.detected_source`` set when applicable; missing
   ``GMAIL_USER`` env var → ``poll_and_ingest`` returns 0 silently.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models import JobPosting, User
from app.services.sources import gmail_digest


# --- Fakes ------------------------------------------------------------------


def _fake_response(payload: dict) -> SimpleNamespace:
    """Stand-in for ``anthropic.types.Message``."""
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=json.dumps(payload))],
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
    )


class _FakeMessages:
    def __init__(self, responses):
        # ``responses`` may be a single value or a list (one per call).
        self._responses = responses
        self._idx = 0
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self._responses, list):
            r = self._responses[min(self._idx, len(self._responses) - 1)]
            self._idx += 1
            return r
        return self._responses


class _FakeApiClient:
    def __init__(self, responses):
        self.messages = _FakeMessages(responses)


async def _ensure_user(db) -> None:
    existing = (
        await db.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(id=1))
        await db.commit()


# --- extract_postings (Haiku) ----------------------------------------------


@pytest.mark.asyncio
async def test_extract_postings_returns_list(monkeypatch, db_session):
    fake = _FakeApiClient(
        _fake_response(
            {
                "postings": [
                    {
                        "company": "Anthropic",
                        "title": "Backend Engineer",
                        "apply_url": "https://boards.greenhouse.io/anthropic/jobs/1",
                        "location": "Remote",
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(gmail_digest, "get_api_client", lambda: fake)

    out = await gmail_digest.extract_postings(
        db_session, html_body="<html>blah</html>"
    )
    assert isinstance(out, list)
    assert len(out) == 1
    assert out[0]["company"] == "Anthropic"
    assert out[0]["apply_url"].startswith("https://")


@pytest.mark.asyncio
async def test_extract_postings_empty_email(monkeypatch, db_session):
    fake = _FakeApiClient(_fake_response({"postings": []}))
    monkeypatch.setattr(gmail_digest, "get_api_client", lambda: fake)

    out = await gmail_digest.extract_postings(
        db_session, html_body="<html>nothing here</html>"
    )
    assert out == []


# --- poll_and_ingest --------------------------------------------------------


@pytest.mark.asyncio
async def test_poll_and_ingest_no_emails_is_noop(monkeypatch, db_session):
    monkeypatch.setenv("GMAIL_USER", "me@example.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "pw")

    async def _no_mail():
        return []

    monkeypatch.setattr(gmail_digest, "fetch_unread_emails", _no_mail)
    await _ensure_user(db_session)

    n = await gmail_digest.poll_and_ingest(db_session, user_id=1)
    assert n == 0


@pytest.mark.asyncio
async def test_poll_and_ingest_creates_multiple_postings_per_email(
    monkeypatch, db_session
):
    monkeypatch.setenv("GMAIL_USER", "me@example.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "pw")
    await _ensure_user(db_session)

    seen_setflag: list[str] = []

    async def _emails():
        return [("123", "<html>email body</html>")]

    async def _mark_seen(uid: str):
        seen_setflag.append(uid)

    monkeypatch.setattr(gmail_digest, "fetch_unread_emails", _emails)
    monkeypatch.setattr(gmail_digest, "mark_seen", _mark_seen)

    fake = _FakeApiClient(
        _fake_response(
            {
                "postings": [
                    {
                        "company": "Anthropic",
                        "title": "Backend Engineer",
                        "apply_url": "https://boards.greenhouse.io/anthropic/jobs/1",
                        "location": "Remote",
                    },
                    {
                        "company": "Notion",
                        "title": "Frontend",
                        "apply_url": "https://example.com/notion/jobs/2",
                        "location": "SF",
                    },
                ]
            }
        )
    )
    monkeypatch.setattr(gmail_digest, "get_api_client", lambda: fake)

    n = await gmail_digest.poll_and_ingest(db_session, user_id=1)
    assert n == 2
    assert seen_setflag == ["123"]

    rows = (
        await db_session.execute(
            select(JobPosting).where(JobPosting.source == "gmail_digest")
        )
    ).scalars().all()
    assert len(rows) == 2
    by_title = {r.title: r for r in rows}
    # First posting's apply_url is a Greenhouse URL → meta.detected_source set.
    gh_row = by_title["Backend Engineer"]
    assert gh_row.meta.get("detected_source") == "greenhouse"
    # Second posting URL doesn't match any adapter — no detected_source.
    other = by_title["Frontend"]
    assert "detected_source" not in (other.meta or {})
    # company_id is null for gmail-sourced postings.
    assert all(r.company_id is None for r in rows)


@pytest.mark.asyncio
async def test_poll_and_ingest_duplicate_apply_url_collapses(
    monkeypatch, db_session
):
    monkeypatch.setenv("GMAIL_USER", "me@example.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "pw")
    await _ensure_user(db_session)

    async def _emails():
        return [("u1", "<html>x</html>")]

    monkeypatch.setattr(gmail_digest, "fetch_unread_emails", _emails)

    async def _mark_seen(uid):
        return None

    monkeypatch.setattr(gmail_digest, "mark_seen", _mark_seen)

    fake = _FakeApiClient(
        _fake_response(
            {
                "postings": [
                    {
                        "company": "X",
                        "title": "T",
                        "apply_url": "https://example.com/jobs/dup",
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(gmail_digest, "get_api_client", lambda: fake)

    n1 = await gmail_digest.poll_and_ingest(db_session, user_id=1)
    assert n1 == 1

    # Second run with the same payload — upsert collapses.
    n2 = await gmail_digest.poll_and_ingest(db_session, user_id=1)
    assert n2 == 0

    rows = (
        await db_session.execute(
            select(JobPosting).where(JobPosting.source == "gmail_digest")
        )
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_poll_and_ingest_missing_gmail_user_returns_zero(
    monkeypatch, db_session
):
    monkeypatch.delenv("GMAIL_USER", raising=False)
    await _ensure_user(db_session)
    n = await gmail_digest.poll_and_ingest(db_session, user_id=1)
    assert n == 0
