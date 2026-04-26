import pytest
from sqlalchemy import text

from app.db import engine


@pytest.mark.asyncio
async def test_pgvector_extension_present():
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
        )
        assert result.scalar() == "vector"


@pytest.mark.asyncio
async def test_profile_table_exists():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT to_regclass('profile')"))
        assert result.scalar() == "profile"
