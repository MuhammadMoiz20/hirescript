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
        result = await conn.execute(text("SELECT to_regclass('profiles')"))
        assert result.scalar() == "profiles"


@pytest.mark.asyncio
async def test_kb_tables_exist():
    async with engine.connect() as conn:
        for t in ("kb_documents", "kb_chunks"):
            assert (await conn.execute(text(f"SELECT to_regclass('{t}')"))).scalar() == t


@pytest.mark.asyncio
async def test_kb_chunks_has_vector_index():
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename='kb_chunks'"))).all()
        assert any("embedding" in r[0] for r in rows)
