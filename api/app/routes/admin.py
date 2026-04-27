"""Admin / E2E test-only routes.

Gated behind ``E2E_TESTING=1`` env var so it 404s in production. The routes
here exist to support hermetic Playwright E2E tests (Slice 2 Task 18) that
need to seed a known posting into the DB without spinning up the full
Greenhouse ingest worker.

Do NOT add behaviors here that production code depends on. If you find
yourself wanting to call something here from a non-test path, lift it into
a real service instead.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Company, JobPosting

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_e2e_enabled() -> None:
    if os.getenv("E2E_TESTING") != "1":
        # 404 — pretend the route doesn't exist outside test mode.
        raise HTTPException(status_code=404, detail="Not found")


class SeedPostingBody(BaseModel):
    company_slug: str
    company_name: str | None = None
    source: str = "greenhouse"
    source_job_id: str
    title: str
    apply_url: str
    description_text: str
    location: str | None = None
    tier: str | None = "targeted"
    fit_score: int | None = 75
    status: str = "classified"


@router.post("/seed-posting")
async def seed_posting(
    body: SeedPostingBody,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Insert a Company (if missing) + JobPosting row for E2E tests.

    Idempotent on ``(user_id, source, source_job_id)``: re-seeding the same
    posting returns the existing row.
    """
    _require_e2e_enabled()

    company = (
        await db.execute(select(Company).where(Company.slug == body.company_slug))
    ).scalar_one_or_none()
    if company is None:
        company = Company(
            slug=body.company_slug,
            display_name=body.company_name or body.company_slug,
            source=body.source,
            enabled=True,
        )
        db.add(company)
        await db.flush()

    existing = (
        await db.execute(
            select(JobPosting).where(
                JobPosting.user_id == user_id,
                JobPosting.source == body.source,
                JobPosting.source_job_id == body.source_job_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await db.commit()
        return {"id": existing.id, "company_id": company.id, "created": False}

    posting = JobPosting(
        user_id=user_id,
        source=body.source,
        source_job_id=body.source_job_id,
        company_id=company.id,
        title=body.title,
        location=body.location,
        apply_url=body.apply_url,
        description_text=body.description_text,
        meta={},
        tier=body.tier,
        fit_score=body.fit_score,
        status=body.status,
    )
    db.add(posting)
    await db.commit()
    await db.refresh(posting)
    return {"id": posting.id, "company_id": company.id, "created": True}
