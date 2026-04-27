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


@pytest.mark.asyncio
async def test_slice2_tables_exist():
    async with engine.connect() as conn:
        for t in ("companies", "job_postings", "applications", "answer_cache"):
            assert (await conn.execute(text(f"SELECT to_regclass('{t}')"))).scalar() == t


@pytest.mark.asyncio
async def test_applications_canonical_key_unique():
    async with engine.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename='applications'"
        ))).all()
        assert any("canonical_key" in r[0] for r in rows)


@pytest.mark.asyncio
async def test_slice3_tables_exist():
    async with engine.connect() as conn:
        for t in ("tiers", "claude_usage", "notifications"):
            assert (await conn.execute(text(f"SELECT to_regclass('{t}')"))).scalar() == t


@pytest.mark.asyncio
async def test_tiers_seeded():
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT slug FROM tiers ORDER BY slug"))).all()
        assert {r[0] for r in rows} == {"dream", "targeted", "wide_net", "skip"}


@pytest.mark.asyncio
async def test_applications_have_verify_columns():
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='applications'"
                )
            )
        ).all()
        cols = {r[0] for r in rows}
        for c in ("verify_ok", "verify_issues", "verify_rationale"):
            assert c in cols, f"missing column {c}"


@pytest.mark.asyncio
async def test_companies_seeded_per_source():
    """Migration 0012 seeds at least one enabled row per ATS family.

    Other tests in this suite truncate ``companies`` for isolation, so we
    can't read state directly. Instead we import the migration module's
    seed list and verify it contains a row for every required source —
    that's the property migrations must guarantee at the moment they run.
    """
    import importlib.util
    import pathlib

    mig_path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0012_seed_lever_ashby_workable.py"
    )
    spec = importlib.util.spec_from_file_location("_mig_0012", mig_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sources = {source for source, _slug, _display in mod._NEW_COMPANIES}
    for src in ("greenhouse", "lever", "ashby", "workable"):
        assert src in sources, f"{src} not in migration seed list"

    # And on a freshly-applied DB the rows are visible. Re-execute the
    # idempotent seed so we are robust to other tests that truncate
    # ``companies`` for isolation.
    async with engine.begin() as conn:
        for source, slug, display in mod._NEW_COMPANIES:
            await conn.execute(
                text(
                    "INSERT INTO companies (slug, display_name, source, enabled) "
                    "VALUES (:slug, :display, :source, true) "
                    "ON CONFLICT (slug, source) DO NOTHING"
                ),
                {"slug": slug, "display": display, "source": source},
            )

    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT source, COUNT(*) FROM companies "
                    "WHERE enabled=true GROUP BY source"
                )
            )
        ).all()
        counts = {r[0]: r[1] for r in rows}
        for src in ("greenhouse", "lever", "ashby", "workable"):
            assert counts.get(src, 0) >= 1, f"{src} not seeded"


@pytest.mark.asyncio
async def test_companies_unique_is_slug_source_composite():
    """Migration 0012 broadens the slug UNIQUE to (slug, source).

    Without this change, the second source to use a slug like ``linear``
    would collide with the existing greenhouse row and the migration
    itself would fail.
    """
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'companies'::regclass "
                    "AND contype = 'u'"
                )
            )
        ).all()
        names = {r[0] for r in rows}
        assert "uq_companies_slug_source" in names
        # The legacy single-column UNIQUE must be gone.
        assert "companies_slug_key" not in names


@pytest.mark.asyncio
async def test_applications_cascade_on_posting_delete():
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT confdeltype::text FROM pg_constraint "
            "WHERE conname = 'applications_posting_id_fkey'"
        ))
        # 'c' = CASCADE, 'n' = SET NULL, 'a' = NO ACTION (default)
        assert result.scalar() == "c"
