import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Job
from app.schemas import (
    EnqueueTailorIn,
    EnqueueTailorOut,
    JobListOut,
    JobOut,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("/tailor", response_model=EnqueueTailorOut)
async def enqueue_tailor(
    body: EnqueueTailorIn,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.items:
        raise HTTPException(400, "items required")
    batch_id = uuid.uuid4()
    jobs: list[Job] = []
    for item in body.items:
        j = Job(
            kind="tailor",
            status="queued",
            batch_id=batch_id,
            payload={
                "resume_id": body.resume_id,
                "jd_text": item.jd_text,
                "title": item.title,
                "company": item.company,
                "url": item.url,
                "deep": body.deep,
            },
        )
        db.add(j)
        jobs.append(j)
    await db.commit()
    for j in jobs:
        await db.refresh(j)
    return EnqueueTailorOut(batch_id=batch_id, job_ids=[j.id for j in jobs])


@router.get("", response_model=JobListOut)
async def list_jobs(
    status: str | None = None,
    batch_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Job).order_by(Job.created_at.desc())
    if status:
        stmt = stmt.where(Job.status.in_(status.split(",")))
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(stmt.limit(limit).offset(offset))
    ).scalars().all()
    return JobListOut(
        items=[JobOut.model_validate(r) for r in rows], total=total
    )


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: uuid.UUID,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    job = (
        await db.execute(select(Job).where(Job.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise HTTPException(404)
    return JobOut.model_validate(job)
