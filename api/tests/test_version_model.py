import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models import Base, User, Resume, ResumeVersion


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s


async def test_versions_persist_in_order(session):
    user = User(id=1)
    session.add(user); await session.flush()
    r = Resume(user_id=1, kind="master", name="x", template_id="jakes", latex_source="a")
    session.add(r); await session.flush()
    session.add(ResumeVersion(resume_id=r.id, latex_source="v1", page_count=1, edit_source="manual"))
    session.add(ResumeVersion(resume_id=r.id, latex_source="v2", page_count=1, edit_source="ai_chat", edit_prompt="tighten"))
    await session.commit()
    rows = (await session.execute(
        select(ResumeVersion).where(ResumeVersion.resume_id == r.id).order_by(ResumeVersion.id.asc())
    )).scalars().all()
    assert [v.latex_source for v in rows] == ["v1", "v2"]
    assert rows[1].edit_prompt == "tighten"
