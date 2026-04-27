"""Tests for dream-tier research agent + runner.

The Sonnet/Opus call is mocked at the
``app.services.agents.dream_research.research_company`` boundary so no
real model invocation happens.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import (
    Application,
    ApplicationResearch,
    Company,
    Job,
    JobPosting,
)
from app.services import jobs_runner
from app.services.agents import dream_research as dr


@pytest.fixture(autouse=True)
async def _clean():
    async with SessionLocal() as s:
        await s.execute(delete(ApplicationResearch))
        await s.execute(delete(Application))
        await s.execute(delete(JobPosting))
        await s.execute(delete(Company))
        await s.execute(delete(Job))
        await s.commit()
    yield
    async with SessionLocal() as s:
        await s.execute(delete(ApplicationResearch))
        await s.execute(delete(Application))
        await s.execute(delete(JobPosting))
        await s.execute(delete(Company))
        await s.execute(delete(Job))
        await s.commit()


async def _seed_dream_application() -> tuple[int, int]:
    """Insert a dream-tier posting + application; return (posting_id, app_id)."""
    async with SessionLocal() as s:
        company = Company(
            slug="anthropic",
            display_name="Anthropic",
            source="greenhouse",
            enabled=True,
        )
        s.add(company)
        await s.flush()
        posting = JobPosting(
            user_id=1,
            source="greenhouse",
            source_job_id="dream-1",
            company_id=company.id,
            title="Senior Engineer",
            location="SF",
            apply_url="https://example.com/x",
            description_text="Join us.",
            tier="dream",
            meta={},
        )
        s.add(posting)
        await s.flush()
        app = Application(
            user_id=1,
            posting_id=posting.id,
            mode="B",
            status="prepared",
            canonical_key="anthropic-senior-engineer",
        )
        s.add(app)
        await s.commit()
        return posting.id, app.id


@pytest.mark.asyncio
async def test_runner_persists_brief_and_signals(monkeypatch):
    posting_id, app_id = await _seed_dream_application()

    fake = {
        "brief_md": "# Anthropic\n\nFocus on AI safety...",
        "signals": {
            "recent_news": ["Series E"],
            "hiring_signals": ["20 SWE roles open"],
            "people": ["Dario Amodei (CEO)"],
        },
    }

    async def fake_research(*args, **kwargs):
        return fake

    monkeypatch.setattr(dr, "research_company", fake_research)

    job_id = uuid.uuid4()
    async with SessionLocal() as s:
        s.add(
            Job(
                id=job_id,
                kind="dream_research",
                status="queued",
                payload={"application_id": app_id},
            )
        )
        await s.commit()

    runner = jobs_runner.RUNNERS["dream_research"]
    await runner(SessionLocal, job_id)

    async with SessionLocal() as s:
        row = (
            await s.execute(
                select(ApplicationResearch).where(
                    ApplicationResearch.application_id == app_id
                )
            )
        ).scalar_one()
    assert "Anthropic" in row.brief_md
    assert row.signals_json["recent_news"] == ["Series E"]
    assert row.model.startswith("claude-")
    assert row.generated_at is not None


@pytest.mark.asyncio
async def test_runner_is_idempotent_per_application(monkeypatch):
    posting_id, app_id = await _seed_dream_application()

    async def fake_research(*args, **kwargs):
        return {
            "brief_md": "First brief.",
            "signals": {"recent_news": [], "hiring_signals": [], "people": []},
        }

    monkeypatch.setattr(dr, "research_company", fake_research)

    runner = jobs_runner.RUNNERS["dream_research"]
    for _ in range(2):
        job_id = uuid.uuid4()
        async with SessionLocal() as s:
            s.add(
                Job(
                    id=job_id,
                    kind="dream_research",
                    status="queued",
                    payload={"application_id": app_id},
                )
            )
            await s.commit()
        await runner(SessionLocal, job_id)

    async with SessionLocal() as s:
        rows = (
            await s.execute(
                select(ApplicationResearch).where(
                    ApplicationResearch.application_id == app_id
                )
            )
        ).scalars().all()
    # Unique constraint on application_id keeps it to one row.
    assert len(rows) == 1
