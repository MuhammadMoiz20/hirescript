from contextlib import asynccontextmanager
from fastapi import FastAPI
from sqlalchemy import select
from app.db import SessionLocal
from app.models import User
from app.routes import auth, resumes

@asynccontextmanager
async def lifespan(app):
    async with SessionLocal() as s:
        existing = await s.execute(select(User).where(User.id == 1))
        if existing.scalar_one_or_none() is None:
            s.add(User(id=1))
            await s.commit()
    yield

app = FastAPI(title="HireScript API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(resumes.router)

@app.get("/health")
def health():
    return {"status": "ok"}
