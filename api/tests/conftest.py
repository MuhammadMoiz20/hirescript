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
