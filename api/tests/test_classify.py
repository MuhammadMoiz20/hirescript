"""Behavioral tests for :func:`app.services.classify.classify_posting`.

We monkeypatch ``query_json`` at the classify module's binding so no real
Claude calls happen. The service is exercised directly against the in-memory
sqlite session.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import JobPosting, Profile as ProfileModel, User
from app.services import classify
from app.services.agent import AgentError


async def _ensure_user(db) -> None:
    existing = (
        await db.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(id=1))
        await db.commit()


async def _seed_profile(db, *, dealbreakers=None, role_families=None) -> None:
    db.add(
        ProfileModel(
            user_id=1,
            data={
                "legal_name": "Moiz",
                "preferences": {
                    "salary_floor_usd": 150000,
                    "salary_target_usd": 200000,
                    "role_families": role_families or ["backend", "ml"],
                    "dealbreakers": dealbreakers or [],
                    "company_stages": ["series_b_plus", "public"],
                    "work_modes": ["remote", "hybrid"],
                },
            },
        )
    )
    await db.commit()


async def _seed_posting(db, **overrides) -> int:
    posting = JobPosting(
        user_id=1,
        source="greenhouse",
        source_job_id=overrides.get("source_job_id", "1"),
        company_id=None,
        title=overrides.get("title", "Senior Backend Engineer"),
        location=overrides.get("location", "Remote (US)"),
        apply_url=overrides.get("apply_url", "https://example.test/apply/1"),
        description_html=None,
        description_text=overrides.get("description_text", "We build infra."),
        meta={},
        status="new",
    )
    db.add(posting)
    await db.commit()
    await db.refresh(posting)
    return posting.id


@pytest.mark.asyncio
async def test_classify_posting_writes_tier_and_score(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    captured = {}

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        captured["system"] = system_prompt
        captured["user"] = user_prompt
        captured["tier"] = tier
        return {"tier": "targeted", "fit_score": 72, "rationale": "Solid fit."}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    out = await classify.classify_posting(db_session, posting_id=posting_id)

    assert out == {"tier": "targeted", "fit_score": 72, "rationale": "Solid fit."}
    assert captured["tier"] == "haiku"
    # Posting body should appear in prompt for grounding.
    assert "Senior Backend Engineer" in captured["user"]
    assert "We build infra." in captured["user"]

    refreshed = (
        await db_session.execute(
            select(JobPosting).where(JobPosting.id == posting_id)
        )
    ).scalar_one()
    assert refreshed.tier == "targeted"
    assert refreshed.fit_score == 72
    assert refreshed.classification_rationale == "Solid fit."
    assert refreshed.status == "classified"


@pytest.mark.asyncio
async def test_classify_posting_does_not_overwrite_non_new_status(
    monkeypatch, db_session
):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    # Manually mark posting as already prepared.
    p = (
        await db_session.execute(
            select(JobPosting).where(JobPosting.id == posting_id)
        )
    ).scalar_one()
    p.status = "prepared"
    await db_session.commit()

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        return {"tier": "wide_net", "fit_score": 50, "rationale": "ok"}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    await classify.classify_posting(db_session, posting_id=posting_id)

    refreshed = (
        await db_session.execute(
            select(JobPosting).where(JobPosting.id == posting_id)
        )
    ).scalar_one()
    assert refreshed.tier == "wide_net"
    assert refreshed.status == "prepared"


@pytest.mark.asyncio
async def test_classify_posting_rejects_invalid_tier(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        return {"tier": "amazing", "fit_score": 90, "rationale": "wow"}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    with pytest.raises(AgentError):
        await classify.classify_posting(db_session, posting_id=posting_id)


@pytest.mark.asyncio
async def test_classify_posting_rejects_invalid_fit_score(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        return {"tier": "targeted", "fit_score": 250, "rationale": "off"}

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    with pytest.raises(AgentError):
        await classify.classify_posting(db_session, posting_id=posting_id)


@pytest.mark.asyncio
async def test_classify_posting_propagates_agent_error(monkeypatch, db_session):
    await _ensure_user(db_session)
    await _seed_profile(db_session)
    posting_id = await _seed_posting(db_session)

    async def fake_query_json(*, system_prompt, user_prompt, tier):
        raise AgentError("invalid JSON")

    monkeypatch.setattr(classify, "query_json", fake_query_json)

    with pytest.raises(AgentError):
        await classify.classify_posting(db_session, posting_id=posting_id)
