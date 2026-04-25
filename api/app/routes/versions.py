from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Resume, ResumeVersion
from app.schemas import ResumeOut, VersionDetail, VersionSummary
from app.services.storage import presign_get
from app.services.versioning import snapshot_resume_version

router = APIRouter(prefix="/resumes")


async def _ensure_owned(resume_id: int, user_id: int, db: AsyncSession) -> Resume:
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    return r


@router.get("/{resume_id}/versions", response_model=list[VersionSummary])
async def list_versions(
    resume_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_owned(resume_id, user_id, db)
    rows = (
        await db.execute(
            select(ResumeVersion)
            .where(ResumeVersion.resume_id == resume_id)
            .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
        )
    ).scalars().all()
    return rows


@router.get(
    "/{resume_id}/versions/{version_id}", response_model=VersionDetail
)
async def get_version(
    resume_id: int,
    version_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_owned(resume_id, user_id, db)
    v = await db.get(ResumeVersion, version_id)
    if v is None or v.resume_id != resume_id:
        raise HTTPException(404)
    return v


@router.get("/{resume_id}/versions/{version_id}/pdf")
async def get_version_pdf(
    resume_id: int,
    version_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_owned(resume_id, user_id, db)
    v = await db.get(ResumeVersion, version_id)
    if v is None or v.resume_id != resume_id:
        raise HTTPException(404)
    if not v.compiled_pdf_key:
        raise HTTPException(404, detail={"error": "no_pdf"})
    url = presign_get(key=v.compiled_pdf_key)
    return RedirectResponse(url=url, status_code=302)


@router.post(
    "/{resume_id}/versions/{version_id}/rollback", response_model=ResumeOut
)
async def rollback_version(
    resume_id: int,
    version_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    r = await _ensure_owned(resume_id, user_id, db)
    v = await db.get(ResumeVersion, version_id)
    if v is None or v.resume_id != resume_id:
        raise HTTPException(404)
    r.latex_source = v.latex_source
    r.content_json = v.content_json
    await snapshot_resume_version(
        db=db,
        resume=r,
        page_count=v.page_count,
        edit_source="rollback",
        edit_prompt=f"to v{version_id}",
    )
    await db.commit()
    await db.refresh(r)
    return r
