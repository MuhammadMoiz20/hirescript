"""Companies CRUD routes — manage the per-source allowlist.

The user-facing pivot point for the multi-source ingest pipeline.
``POST /companies`` runs a sanity-check fetch via the matching adapter
so a typo cannot silently produce zero ingest results. ``DELETE`` is a
soft delete (``enabled=false``) so historical postings keep their
``company_id`` foreign key intact.

All routes are gated by ``require_user`` (single-tenant; ``user_id=1``).
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Company
from app.schemas.company import CompanyCreate, CompanyOut, CompanyUpdate
from app.services.sources import SOURCES

router = APIRouter(prefix="/companies", tags=["companies"])

log = logging.getLogger(__name__)


@router.get("", response_model=list[CompanyOut])
async def list_companies(
    source: str | None = None,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """List companies, optionally filtered by ``source``.

    Returns both enabled + disabled rows so the UI can show / restore
    soft-deleted entries.
    """
    stmt = select(Company)
    if source is not None:
        stmt = stmt.where(Company.source == source)
    rows = (
        await db.execute(stmt.order_by(Company.source, Company.slug))
    ).scalars().all()
    return rows


@router.post("", response_model=CompanyOut, status_code=201)
async def create_company(
    body: CompanyCreate,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a company allowlist row.

    1. Validate ``source`` is registered in :data:`SOURCES` (422 otherwise).
    2. Sanity-check fetch via the adapter — if it returns 0 postings or
       raises, reject with 422 and a clear error. This is what stops
       typos from quietly producing zero ingest results downstream.
    3. Insert the row. Duplicate ``(slug, source)`` is a 409.
    """
    adapter = SOURCES.get(body.source)
    if adapter is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"unknown source {body.source!r} — must be one of "
                f"{sorted(SOURCES.keys())}"
            ),
        )

    try:
        async with httpx.AsyncClient(timeout=20) as http:
            postings = await adapter.fetch_company_postings(
                body.slug, http=http
            )
    except Exception as exc:  # noqa: BLE001 — surface as 422 to the user
        log.warning(
            "sanity-check fetch failed for %s:%s — %s",
            body.source,
            body.slug,
            exc,
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"sanity-check fetch failed for {body.source}:{body.slug}: "
                f"{exc}"
            ),
        ) from exc

    if not postings:
        raise HTTPException(
            status_code=422,
            detail=(
                f"sanity-check fetch returned zero postings for "
                f"{body.source}:{body.slug} — check the slug spelling"
            ),
        )

    company = Company(
        slug=body.slug,
        display_name=body.display_name,
        source=body.source,
        enabled=True,
    )
    db.add(company)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f"company {body.source}:{body.slug} already exists"
            ),
        ) from exc
    await db.refresh(company)
    return company


async def _load_company(
    db: AsyncSession, company_id: int
) -> Company:
    company = (
        await db.execute(select(Company).where(Company.id == company_id))
    ).scalar_one_or_none()
    if company is None:
        raise HTTPException(status_code=404, detail="Not found")
    return company


@router.patch("/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: int,
    patch: CompanyUpdate,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    company = await _load_company(db, company_id)
    updates = patch.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(company, key, value)
    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft delete — flip ``enabled`` to false so historical postings
    keep their FK reference intact and the row can be restored.
    """
    company = await _load_company(db, company_id)
    company.enabled = False
    await db.commit()
    return Response(status_code=204)
