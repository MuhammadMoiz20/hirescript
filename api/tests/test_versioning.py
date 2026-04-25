import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models import Base, User, Resume, ResumeVersion
from app.services.versioning import snapshot_resume_version


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s


async def test_snapshots_current_state(session):
    user = User(id=1); session.add(user); await session.flush()
    r = Resume(user_id=1, kind="master", name="x", template_id="jakes",
               latex_source="L1", content_json={"k":"v"})
    session.add(r); await session.flush()
    v = await snapshot_resume_version(db=session, resume=r, page_count=1, edit_source="manual")
    await session.commit()
    assert v.id is not None
    assert v.latex_source == "L1"
    assert v.content_json == {"k":"v"}
    assert v.edit_source == "manual"
    assert v.edit_prompt is None


async def test_records_edit_prompt(session):
    user = User(id=1); session.add(user); await session.flush()
    r = Resume(user_id=1, kind="master", name="x", template_id="jakes", latex_source="L")
    session.add(r); await session.flush()
    await snapshot_resume_version(db=session, resume=r, page_count=2, edit_source="ai_chat", edit_prompt="tighten experience")
    await session.commit()
    rows = (await session.execute(select(ResumeVersion))).scalars().all()
    assert rows[0].edit_prompt == "tighten experience"
    assert rows[0].page_count == 2
