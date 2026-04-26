import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Job
from app.schemas import EnqueueTailorIn, EnqueueTailorOut

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
