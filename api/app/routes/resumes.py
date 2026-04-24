from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_user
from app.db import get_db
from app.models import Resume
from app.schemas import ResumeCreate, ResumeUpdate, ResumeOut
from app.templates import get_template

router = APIRouter(prefix="/resumes")

@router.post("", response_model=ResumeOut, status_code=201)
async def create_resume(body: ResumeCreate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    try:
        tpl = get_template(body.template_id)
    except KeyError:
        raise HTTPException(404, "unknown template")
    resume = Resume(user_id=user_id, kind="master", name=body.name, template_id=body.template_id, latex_source=tpl["latex_skeleton"])
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume

@router.get("", response_model=list[ResumeOut])
async def list_resumes(user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(Resume).where(Resume.user_id == user_id).order_by(Resume.updated_at.desc()))
    return rows.scalars().all()

@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(resume_id: int, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    return r

@router.put("/{resume_id}", response_model=ResumeOut)
async def update_resume(resume_id: int, body: ResumeUpdate, user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user_id:
        raise HTTPException(404)
    if body.name is not None:
        r.name = body.name
    if body.latex_source is not None:
        r.latex_source = body.latex_source
    await db.commit()
    await db.refresh(r)
    return r
