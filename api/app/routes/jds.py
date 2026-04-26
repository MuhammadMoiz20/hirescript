from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import JobDescription
from app.schemas import JobDescriptionOut

router = APIRouter(prefix="/jds")


@router.get("/{jd_id}", response_model=JobDescriptionOut)
async def get_jd(
    jd_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    jd = await db.get(JobDescription, jd_id)
    if jd is None or jd.user_id != user_id:
        raise HTTPException(404)
    return jd
