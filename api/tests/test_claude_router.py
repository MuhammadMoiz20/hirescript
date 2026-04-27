"""Tests for :mod:`app.services.claude_router`.

The router decides per task_kind whether to dispatch through the Max-plan
Agent SDK client or the API-key Anthropic client. It also tracks Max-window
load via rows in ``claude_usage``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import ClaudeUsage, Tier
from app.services import claude_router


async def _seed_tiers(db) -> None:
    db.add_all(
        [
            Tier(
                slug="dream",
                display_name="Dream",
                min_fit_score=85,
                daily_cap=999,
                default_mode="B",
                tailor_model="opus-4.7",
            ),
            Tier(
                slug="targeted",
                display_name="Targeted",
                min_fit_score=65,
                daily_cap=20,
                default_mode="A",
                tailor_model="sonnet-4.6",
            ),
            Tier(
                slug="wide_net",
                display_name="Wide net",
                min_fit_score=40,
                daily_cap=50,
                default_mode="A",
                tailor_model="sonnet-4.6",
            ),
            Tier(
                slug="skip",
                display_name="Skip",
                min_fit_score=0,
                daily_cap=0,
                default_mode="B",
                tailor_model="haiku-4.5",
            ),
        ]
    )
    await db.commit()


@pytest.mark.asyncio
async def test_classify_picks_max_haiku(db_session):
    await _seed_tiers(db_session)
    choice = await claude_router.choose(db_session, task_kind="classify")
    assert choice == {"client": "max", "model": "claude-haiku-4-5"}


@pytest.mark.asyncio
async def test_cover_letter_picks_max_haiku(db_session):
    await _seed_tiers(db_session)
    choice = await claude_router.choose(db_session, task_kind="cover_letter")
    assert choice == {"client": "max", "model": "claude-haiku-4-5"}


@pytest.mark.asyncio
async def test_verify_picks_max_haiku(db_session):
    await _seed_tiers(db_session)
    choice = await claude_router.choose(db_session, task_kind="verify")
    assert choice == {"client": "max", "model": "claude-haiku-4-5"}


@pytest.mark.asyncio
async def test_tailor_under_budget_uses_max_with_tier_model(
    db_session, monkeypatch
):
    await _seed_tiers(db_session)

    async def fake_load(_db):
        return 0.1

    monkeypatch.setattr(claude_router, "max_window_load", fake_load)
    choice = await claude_router.choose(
        db_session, task_kind="tailor", tier_slug="targeted"
    )
    assert choice == {"client": "max", "model": "claude-sonnet-4-6"}

    choice2 = await claude_router.choose(
        db_session, task_kind="tailor", tier_slug="dream"
    )
    assert choice2 == {"client": "max", "model": "claude-opus-4-7"}


@pytest.mark.asyncio
async def test_tailor_over_budget_still_uses_max(
    db_session, monkeypatch
):
    """All tasks now route through Max regardless of window load — the
    API-key fallback was removed when we deleted ``get_api_client``."""
    await _seed_tiers(db_session)

    async def fake_load(_db):
        return 0.95

    monkeypatch.setattr(claude_router, "max_window_load", fake_load)
    choice = await claude_router.choose(
        db_session, task_kind="tailor", tier_slug="targeted"
    )
    assert choice == {"client": "max", "model": "claude-sonnet-4-6"}


@pytest.mark.asyncio
async def test_tailor_no_tier_defaults_to_sonnet(db_session, monkeypatch):
    await _seed_tiers(db_session)

    async def fake_load(_db):
        return 0.0

    monkeypatch.setattr(claude_router, "max_window_load", fake_load)
    choice = await claude_router.choose(db_session, task_kind="tailor")
    assert choice == {"client": "max", "model": "claude-sonnet-4-6"}


@pytest.mark.asyncio
async def test_research_under_budget(db_session, monkeypatch):
    await _seed_tiers(db_session)

    async def fake_load(_db):
        return 0.5

    monkeypatch.setattr(claude_router, "max_window_load", fake_load)
    choice = await claude_router.choose(db_session, task_kind="research")
    assert choice == {"client": "max", "model": "claude-sonnet-4-6"}


@pytest.mark.asyncio
async def test_research_over_budget_still_uses_max(db_session, monkeypatch):
    """Research tasks no longer raise WindowExhaustedError — Max is the only
    client, so they always get routed to Max + Sonnet."""
    await _seed_tiers(db_session)

    async def fake_load(_db):
        return 0.9

    monkeypatch.setattr(claude_router, "max_window_load", fake_load)
    choice = await claude_router.choose(db_session, task_kind="research")
    assert choice == {"client": "max", "model": "claude-sonnet-4-6"}


@pytest.mark.asyncio
async def test_unknown_task_kind_raises(db_session):
    await _seed_tiers(db_session)
    with pytest.raises(ValueError):
        await claude_router.choose(db_session, task_kind="unknown")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_record_usage_writes_row(db_session):
    await claude_router.record_usage(
        db_session,
        client="api",
        model="claude-haiku-4-5",
        task_kind="classify",
        input_tokens=123,
        output_tokens=45,
    )
    rows = (await db_session.execute(select(ClaudeUsage))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.client == "api"
    assert row.model == "claude-haiku-4-5"
    assert row.task_kind == "classify"
    assert row.input_tokens == 123
    assert row.output_tokens == 45


@pytest.mark.asyncio
async def test_max_window_load_sums_recent_max_rows(
    db_session, monkeypatch
):
    monkeypatch.setenv("MAX_WINDOW_TOKEN_BUDGET", "1000")
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            # in-window max rows: total 600
            ClaudeUsage(
                client="max",
                model="claude-sonnet-4-6",
                task_kind="tailor",
                input_tokens=200,
                output_tokens=100,
                started_at=now - timedelta(hours=1),
            ),
            ClaudeUsage(
                client="max",
                model="claude-sonnet-4-6",
                task_kind="tailor",
                input_tokens=200,
                output_tokens=100,
                started_at=now - timedelta(hours=2),
            ),
            # out-of-window max row: ignored
            ClaudeUsage(
                client="max",
                model="claude-sonnet-4-6",
                task_kind="tailor",
                input_tokens=10000,
                output_tokens=10000,
                started_at=now - timedelta(hours=6),
            ),
            # api row: ignored regardless of recency
            ClaudeUsage(
                client="api",
                model="claude-haiku-4-5",
                task_kind="classify",
                input_tokens=5000,
                output_tokens=5000,
                started_at=now - timedelta(minutes=5),
            ),
        ]
    )
    await db_session.commit()

    load = await claude_router.max_window_load(db_session)
    assert load == pytest.approx(0.6, rel=1e-6)


@pytest.mark.asyncio
async def test_max_window_load_zero_when_empty(db_session, monkeypatch):
    monkeypatch.setenv("MAX_WINDOW_TOKEN_BUDGET", "1000")
    load = await claude_router.max_window_load(db_session)
    assert load == 0.0
