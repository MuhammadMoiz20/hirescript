import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from sqlalchemy import select
from app.db import SessionLocal
from app.models import User
from app.routes import auth, resumes, versions, jds, profile
from app.services.storage import ensure_bucket

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app):
    async with SessionLocal() as s:
        existing = await s.execute(select(User).where(User.id == 1))
        if existing.scalar_one_or_none() is None:
            s.add(User(id=1))
            await s.commit()
    try:
        ensure_bucket()
    except Exception as e:
        log.warning("ensure_bucket failed at startup: %s", e)
    yield

app = FastAPI(title="HireScript API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(resumes.router)
app.include_router(versions.router)
app.include_router(jds.router)
app.include_router(profile.router)

@app.get("/health")
def health():
    return {"status": "ok"}
