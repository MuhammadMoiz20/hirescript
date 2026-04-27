"""Applications (review queue + submit) routes.

Slice 2 surfaces prepared applications for human review:

- ``GET /applications`` — review queue (default filter ``status=prepared``).
- ``GET /applications/{id}`` — full detail, including resume PDF link.
- ``POST /applications/{id}/submit`` — enqueue a ``submit_application`` job
  (runner registered by Task 15 — until then the worker logs the unknown
  kind and the row sits queued).
- ``DELETE /applications/{id}`` — drop the prepared row.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Application, Company, JobPosting, ResumeVersion
from app.schemas.application import (
    ApplicationDetailOut,
    ApplicationListOut,
    ApplicationOut,
)
from app.services.jobs_repo import enqueue_submit_application

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applications", tags=["applications"])


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


async def _serialize_application(
    db: AsyncSession, app: Application
) -> dict:
    posting = (
        await db.execute(
            select(JobPosting).where(JobPosting.id == app.posting_id)
        )
    ).scalar_one()
    return {
        "id": app.id,
        "posting_id": app.posting_id,
        "posting": await _serialize_posting(db, posting),
        "status": app.status,
        "mode": app.mode,
        "cover_letter_text": app.cover_letter_text,
        "form_payload": app.form_payload,
        "submitted_at": app.submitted_at,
        "error": app.error,
    }


async def _latest_pdf_url(
    db: AsyncSession,
    resume_id: int | None,
    *,
    application_id: int | None = None,
) -> str | None:
    """Return a presigned URL for the latest compiled PDF of ``resume_id``.

    Returns ``None`` when no version exists or none has a compiled key.
    Imports :mod:`app.services.storage` lazily so tests that don't seed
    versions don't hit MinIO.
    """
    if resume_id is None:
        return None
    v = (
        await db.execute(
            select(ResumeVersion)
            .where(
                ResumeVersion.resume_id == resume_id,
                ResumeVersion.compiled_pdf_key.is_not(None),
            )
            .order_by(ResumeVersion.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if v is None or not v.compiled_pdf_key:
        return None
    try:
        from app.services.storage import presign_get

        return presign_get(key=v.compiled_pdf_key)
    except Exception:
        logger.warning(
            "presign failed for application %s resume %s",
            application_id,
            resume_id,
            exc_info=True,
        )
        return None


async def _load_application_for_user(
    db: AsyncSession, application_id: int, user_id: int
) -> Application:
    app = (
        await db.execute(
            select(Application).where(Application.id == application_id)
        )
    ).scalar_one_or_none()
    if app is None:
        raise HTTPException(status_code=404, detail="Not found")
    if app.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return app


@router.get("", response_model=ApplicationListOut)
async def list_applications(
    status: str | None = "prepared",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Review queue. Default filter: ``status=prepared``.

    Pass ``status=`` (empty string) to disable filtering — handy for
    operational views that want every application regardless of state.
    """
    base = select(Application).where(Application.user_id == user_id)
    if status:
        base = base.where(Application.status == status)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    rows = (
        await db.execute(
            base.order_by(Application.prepared_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    items = [await _serialize_application(db, a) for a in rows]
    return {"items": items, "total": int(total or 0)}


@router.get("/{application_id}", response_model=ApplicationDetailOut)
async def get_application(
    application_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    app = await _load_application_for_user(db, application_id, user_id)
    base = await _serialize_application(db, app)
    base.update(
        {
            "resume_variant_id": app.resume_variant_id,
            "resume_pdf_url": await _latest_pdf_url(
                db, app.resume_variant_id, application_id=app.id
            ),
            "canonical_key": app.canonical_key,
            "prepared_at": app.prepared_at,
            "confirmation_html": app.confirmation_html,
            "confirmation_screenshot_path": app.confirmation_screenshot_path,
        }
    )
    return base


@router.post("/{application_id}/submit")
async def submit_application(
    application_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Enqueue a ``submit_application`` job.

    The runner is :func:`app.services.jobs_runner.run_submit_application_job`.
    """
    app = await _load_application_for_user(db, application_id, user_id)
    job_id = await enqueue_submit_application(db, application_id=app.id)
    await db.commit()
    return {"job_id": str(job_id)}


@router.post("/{application_id}/promote_to_A", response_model=ApplicationOut)
async def promote_to_a(
    application_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Flip an application to A-mode.

    If the application is currently in ``captcha_pause`` (a hold imposed
    after a failed challenge), reset it to ``prepared`` so the autonomous
    scheduler picks it up on the next tick.
    """
    app = await _load_application_for_user(db, application_id, user_id)
    app.mode = "A"
    if app.status == "captcha_pause":
        app.status = "prepared"
    await db.commit()
    await db.refresh(app)
    return await _serialize_application(db, app)


@router.post("/{application_id}/pause_A", response_model=ApplicationOut)
async def pause_a(
    application_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Flip an application back to B-mode (human gate)."""
    app = await _load_application_for_user(db, application_id, user_id)
    app.mode = "B"
    await db.commit()
    await db.refresh(app)
    return await _serialize_application(db, app)


@router.delete("/{application_id}", status_code=204)
async def delete_application(
    application_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    app = await _load_application_for_user(db, application_id, user_id)
    await db.execute(sa_delete(Application).where(Application.id == app.id))
    await db.commit()
    return Response(status_code=204)
