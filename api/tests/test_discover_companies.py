"""Tests for the agentic company discovery service + runner.

The agent SDK is mocked at the ``app.services.agents.discover_companies``
boundary so no real model call is made; the source registry's
``fetch_company_postings`` is also stubbed so the validation step passes
without network traffic.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import Company, Job
from app.services import jobs_runner
from app.services.agents import discover_companies as dc
from app.services.sources import SOURCES


@pytest.fixture(autouse=True)
async def _clean():
    async with SessionLocal() as s:
        await s.execute(delete(Company))
        await s.execute(delete(Job))
        await s.commit()
    yield
    async with SessionLocal() as s:
        await s.execute(delete(Company))
        await s.execute(delete(Job))
        await s.commit()


@pytest.mark.asyncio
async def test_runner_inserts_proposals_as_disabled_with_rationale(monkeypatch):
    proposals = {
        "proposals": [
            {
                "source": "greenhouse",
                "slug": "anthropic",
                "display_name": "Anthropic",
                "rationale": "Aligned with AI research interest.",
            },
            {
                "source": "lever",
                "slug": "netflix",
                "display_name": "Netflix",
                "rationale": "Strong eng culture per profile.",
            },
        ]
    }

    async def fake_propose(*args, **kwargs):
        return proposals

    monkeypatch.setattr(dc, "propose_companies", fake_propose)

    # Stub the validation fetch so each proposal is "verified" without HTTP.
    async def fake_fetch(slug, *, http=None, page_factory=None):
        return [{"source_job_id": "1"}]

    for s in ("greenhouse", "lever"):
        monkeypatch.setattr(SOURCES[s], "fetch_company_postings", fake_fetch)

    # Enqueue + run the discover_companies job.
    job_id = uuid.uuid4()
    async with SessionLocal() as s:
        s.add(Job(id=job_id, kind="discover_companies", status="queued", payload={}))
        await s.commit()

    runner = jobs_runner.RUNNERS["discover_companies"]
    await runner(SessionLocal, job_id)

    # Two new rows, both disabled, both tagged discovered_by="agent".
    async with SessionLocal() as s:
        rows = (
            await s.execute(select(Company).order_by(Company.slug))
        ).scalars().all()
    assert len(rows) == 2
    by_slug = {r.slug: r for r in rows}
    a = by_slug["anthropic"]
    assert a.enabled is False
    assert a.discovered_by == "agent"
    assert "AI research" in (a.discovery_rationale or "")
    n = by_slug["netflix"]
    assert n.enabled is False
    assert n.source == "lever"
    assert n.discovered_by == "agent"


@pytest.mark.asyncio
async def test_runner_skips_proposals_that_fail_validation(monkeypatch):
    proposals = {
        "proposals": [
            {
                "source": "greenhouse",
                "slug": "ghost",
                "display_name": "Ghost Co",
                "rationale": "interesting",
            }
        ]
    }

    async def fake_propose(*args, **kwargs):
        return proposals

    async def empty_fetch(slug, *, http=None, page_factory=None):
        return []

    monkeypatch.setattr(dc, "propose_companies", fake_propose)
    monkeypatch.setattr(SOURCES["greenhouse"], "fetch_company_postings", empty_fetch)

    job_id = uuid.uuid4()
    async with SessionLocal() as s:
        s.add(Job(id=job_id, kind="discover_companies", status="queued", payload={}))
        await s.commit()

    runner = jobs_runner.RUNNERS["discover_companies"]
    await runner(SessionLocal, job_id)

    async with SessionLocal() as s:
        rows = (await s.execute(select(Company))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_runner_does_not_repropose_existing_companies(monkeypatch):
    """propose_companies is given the current list; if it returns a slug
    already present (different source), the runner re-checks the
    (slug, source) unique constraint and silently drops the dup.
    """
    async with SessionLocal() as s:
        s.add(
            Company(
                slug="anthropic",
                display_name="Anthropic",
                source="greenhouse",
                enabled=True,
            )
        )
        await s.commit()

    proposals = {
        "proposals": [
            {
                "source": "greenhouse",
                "slug": "anthropic",
                "display_name": "Anthropic",
                "rationale": "dup",
            }
        ]
    }

    async def fake_propose(*args, **kwargs):
        return proposals

    async def fetch_one(slug, *, http=None, page_factory=None):
        return [{"source_job_id": "1"}]

    monkeypatch.setattr(dc, "propose_companies", fake_propose)
    monkeypatch.setattr(SOURCES["greenhouse"], "fetch_company_postings", fetch_one)

    job_id = uuid.uuid4()
    async with SessionLocal() as s:
        s.add(Job(id=job_id, kind="discover_companies", status="queued", payload={}))
        await s.commit()

    runner = jobs_runner.RUNNERS["discover_companies"]
    await runner(SessionLocal, job_id)

    async with SessionLocal() as s:
        rows = (await s.execute(select(Company))).scalars().all()
    # Still exactly one (no duplicate insert).
    assert len(rows) == 1
    assert rows[0].slug == "anthropic"
    # Original row was NOT toggled to disabled.
    assert rows[0].enabled is True
