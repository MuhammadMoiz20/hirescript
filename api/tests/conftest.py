import os

os.environ.setdefault("APP_PASSWORD", "changeme")
os.environ.setdefault("SESSION_SECRET", "test-secret-for-tests-only")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://hirescript:hirescript@db:5432/hirescript",
)

import asyncio

import pytest

# Reset the async engine to use NullPool in tests so connections aren't reused
# across event loops (each TestClient request spawns a fresh portal/loop).
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from app import db as _db
from app.config import settings as _settings

_db.engine = create_async_engine(_settings.database_url, poolclass=NullPool)
_db.SessionLocal = async_sessionmaker(_db.engine, class_=AsyncSession, expire_on_commit=False)


def _bootstrap_user():
    from sqlalchemy import select
    from app.db import SessionLocal, engine
    from app.models import User

    async def _run():
        async with SessionLocal() as s:
            existing = await s.execute(select(User).where(User.id == 1))
            if existing.scalar_one_or_none() is None:
                s.add(User(id=1))
                await s.commit()
        await engine.dispose()

    asyncio.run(_run())


_bootstrap_user()


@pytest.fixture
async def sqlite_engine():
    """Function-scoped in-memory aiosqlite engine for repo/model unit tests.

    Uses a shared-cache URI so multiple connections (one per AsyncSession) see
    the same in-memory database. This is required for the concurrent claim test
    where independent sessions race against each other.
    """
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import StaticPool
    from app.models import Base

    engine = create_async_engine(
        "sqlite+aiosqlite:///file::memory:?cache=shared&uri=true",
        connect_args={"uri": True},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture
async def sessionmaker_factory(sqlite_engine):
    """Returns a callable producing fresh AsyncSession instances on each call.

    Each call yields an independent session bound to the shared engine — this
    is required for the concurrent-claim test where N coroutines must each
    hold their own session/transaction.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

    maker = async_sessionmaker(sqlite_engine, class_=AsyncSession, expire_on_commit=False)
    return maker


@pytest.fixture
async def db_session(sessionmaker_factory):
    """Yields a single AsyncSession for direct setup/inspection in repo tests."""
    async with sessionmaker_factory() as s:
        yield s


@pytest.fixture
async def seeded_master_resume(db_session):
    """Insert ``User(id=1)`` + a master ``Resume``. Returns the persisted Resume."""
    from sqlalchemy import select
    from app.models import Resume, User

    existing = (
        await db_session.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db_session.add(User(id=1))
        await db_session.flush()
    resume = Resume(
        user_id=1,
        kind="master",
        name="Master",
        template_id="jakes",
        latex_source="\\documentclass{article}\\begin{document}x\\end{document}",
        protected_terms=[],
    )
    db_session.add(resume)
    await db_session.commit()
    await db_session.refresh(resume)
    return resume


@pytest.fixture(autouse=True)
def _clear_testclient_cookies():
    """Ensure module-level TestClient instances don't leak cookies across tests."""
    yield
    try:
        from tests.test_auth import client as auth_client
        auth_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_resumes import client as resumes_client
        resumes_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_compile_endpoint import client as compile_client
        compile_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_resume_edits import client as edits_client
        edits_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_tailor_endpoint import client as tailor_client
        tailor_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_sections import client as sections_client
        sections_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_onboard_endpoints import client as onboard_client
        onboard_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_version_snapshots import client as version_snapshots_client
        version_snapshots_client.cookies.clear()
    except Exception:
        pass
    try:
        from tests.test_versions_endpoints import client as versions_endpoints_client
        versions_endpoints_client.cookies.clear()
    except Exception:
        pass
