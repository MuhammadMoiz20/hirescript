import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models import Base, User, Resume


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s


async def test_can_create_user_and_resume(session):
    user = User(id=1)
    session.add(user)
    await session.flush()
    resume = Resume(user_id=1, kind="master", name="Master", template_id="jakes", latex_source="...")
    session.add(resume)
    await session.commit()
    assert resume.id is not None
