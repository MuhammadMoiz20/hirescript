"""Postings (inbox) routes.

Slice 2 surfaces ingested postings to the UI:

- ``GET /postings`` — paginated inbox with optional status/tier filters.
- ``GET /postings/{id}`` — full detail (description, classification, meta).
- ``POST /postings/{id}/prepare`` — enqueue a ``prepare_application`` job.
- ``POST /postings/{id}/skip`` — soft-skip the posting.

All routes are gated by ``require_user`` and scoped to that user's postings.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Company, JobPosting
from app.schemas.posting import (
    JobPostingDetailOut,
    JobPostingOut,
    PostingListOut,
)
from app.services.jobs_repo import enqueue_prepare_application

router = APIRouter(prefix="/postings", tags=["postings"])


async def _company_name(
    db: AsyncSession, company_id: int | None
) -> str | None:
    if company_id is None:
        return None
    row = (
        await db.execute(select(Company).where(Company.id == company_id))
    ).scalar_one_or_none()
    return row.display_name if row is not None else None


async def _serialize_posting(
    db: AsyncSession, posting: JobPosting
) -> dict:
    return {
        "id": posting.id,
        "source": posting.source,
        "source_job_id": posting.source_job_id,
        "company": await _company_name(db, posting.company_id),
        "title": posting.title,
        "location": posting.location,
        "apply_url": posting.apply_url,
        "tier": posting.tier,
        "fit_score": posting.fit_score,
        "status": posting.status,
        "ingested_at": posting.ingested_at,
    }


async def _load_posting_for_user(
    db: AsyncSession, posting_id: int, user_id: int
) -> JobPosting:
    posting = (
        await db.execute(select(JobPosting).where(JobPosting.id == posting_id))
    ).scalar_one_or_none()
    if posting is None:
        raise HTTPException(status_code=404, detail="Not found")
    if posting.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return posting


@router.get("", response_model=PostingListOut)
async def list_postings(
    status: str | None = None,
    tier: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Inbox listing. Default order: ``ingested_at`` DESC."""
    base = select(JobPosting).where(JobPosting.user_id == user_id)
    if status is not None:
        base = base.where(JobPosting.status == status)
    if tier is not None:
        base = base.where(JobPosting.tier == tier)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    rows = (
        await db.execute(
            base.order_by(JobPosting.ingested_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    items = [await _serialize_posting(db, p) for p in rows]
    return {"items": items, "total": int(total or 0)}


@router.get("/{posting_id}", response_model=JobPostingDetailOut)
async def get_posting(
    posting_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    posting = await _load_posting_for_user(db, posting_id, user_id)
    base = await _serialize_posting(db, posting)
    base.update(
        {
            "description_text": posting.description_text,
            "description_html": posting.description_html,
            "meta": posting.meta or {},
            "canonical_key": posting.canonical_key,
            "classification_rationale": posting.classification_rationale,
        }
    )
    return base


@router.post("/{posting_id}/prepare")
async def prepare_posting(
    posting_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Enqueue a ``prepare_application`` job for this posting.

    Returns ``{job_id, batch_id}``. ``batch_id`` is currently a fresh
    uuid per request — the orchestrator does not yet group jobs.
    """
    posting = await _load_posting_for_user(db, posting_id, user_id)
    job_id = await enqueue_prepare_application(db, posting_id=posting.id)
    batch_id = uuid.uuid4()
    await db.commit()
    return {"job_id": str(job_id), "batch_id": str(batch_id)}


@router.post("/{posting_id}/skip")
async def skip_posting(
    posting_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Soft-skip a posting by flipping its status to ``skip``."""
    posting = await _load_posting_for_user(db, posting_id, user_id)
    posting.status = "skip"
    await db.commit()
    return {"id": posting.id, "status": posting.status}
