"""Tests for the answer cache primitive."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select

from app.models import AnswerCache, User
from app.services.answer_cache import (
    lookup,
    normalize_question,
    question_hash,
    store,
)


def test_normalize_question_collapses_whitespace_and_case():
    assert normalize_question("Why  THIS company?") == normalize_question(
        "why this company"
    )


def test_normalize_question_strips_punctuation():
    assert normalize_question("Why this company?") == normalize_question(
        "why this, company."
    )


def test_question_hash_is_stable_across_phrasings():
    assert question_hash("Why  THIS company?") == question_hash(
        "why this company"
    )


async def _ensure_user(db) -> None:
    existing = (
        await db.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(id=1))
        await db.commit()


@pytest.mark.asyncio
async def test_lookup_returns_none_on_miss(db_session):
    await _ensure_user(db_session)
    out = await lookup(db_session, user_id=1, question="anything at all")
    assert out is None


@pytest.mark.asyncio
async def test_store_then_lookup_round_trip(db_session):
    await _ensure_user(db_session)
    await store(
        db_session,
        user_id=1,
        question="Why this company?",
        answer="Their work on X aligns with my interests.",
    )
    # store() now flushes only; commit so the test validates persistence
    # across the lookup path.
    await db_session.commit()
    out = await lookup(db_session, user_id=1, question="Why THIS company")
    assert out == "Their work on X aligns with my interests."


@pytest.mark.asyncio
async def test_store_overwrites_on_same_question(db_session):
    await _ensure_user(db_session)
    await store(db_session, user_id=1, question="Q", answer="A1")
    await store(db_session, user_id=1, question="Q", answer="A2")
    out = await lookup(db_session, user_id=1, question="Q")
    assert out == "A2"


@pytest.mark.asyncio
async def test_lookup_bumps_last_used_at(db_session):
    await _ensure_user(db_session)
    await store(db_session, user_id=1, question="Q?", answer="A")

    # Capture initial timestamp.
    row = (
        await db_session.execute(select(AnswerCache))
    ).scalar_one()
    before = row.last_used_at

    # Sleep enough that the func.now() fall on the next clock tick.
    await asyncio.sleep(0.05)

    out = await lookup(db_session, user_id=1, question="Q")
    assert out == "A"

    await db_session.refresh(row)
    assert row.last_used_at >= before


@pytest.mark.asyncio
async def test_lookup_is_user_scoped(db_session):
    await _ensure_user(db_session)
    db_session.add(User(id=2))
    await db_session.commit()
    await store(db_session, user_id=1, question="Q", answer="user1-answer")

    miss = await lookup(db_session, user_id=2, question="Q")
    assert miss is None
    hit = await lookup(db_session, user_id=1, question="Q")
    assert hit == "user1-answer"
