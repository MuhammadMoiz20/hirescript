import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models import Base, User, Resume, JobDescription


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s


async def test_create_jd_and_variant(session):
    user = User(id=1)
    session.add(user)
    await session.flush()
    master = Resume(user_id=1, kind="master", name="M", template_id="jakes", latex_source="...")
    session.add(master)
    await session.flush()
    jd = JobDescription(user_id=1, title="SWE", company="Acme", raw_text="JD body", parsed_json={"keywords": ["led", "shipped"]})
    session.add(jd)
    await session.flush()
    variant = Resume(
        user_id=1, parent_id=master.id, kind="variant", name="M — Acme",
        template_id="jakes", latex_source="...", job_description_id=jd.id,
    )
    session.add(variant)
    await session.commit()
    assert variant.id is not None
    assert variant.job_description_id == jd.id
    assert variant.parent_id == master.id
    assert jd.parsed_json["keywords"] == ["led", "shipped"]
