"""Tests for the Resume.one_line_per_bullet column.

Covers two distinct defaults:

- Python-side ``default=False``: a newly constructed ``Resume`` ORM
  instance without the flag specified persists as ``False`` (new resumes
  start lax per the design doc).
- DB ``server_default=true``: rows inserted via raw SQL that omit the
  column receive ``True`` (existing rows backfill on migration —
  preserves today's strict behavior).
"""

import pytest
from sqlalchemy import select, text

from app.models import Resume, User


@pytest.mark.asyncio
async def test_new_resume_python_default_is_false(db_session):
    """ORM-constructed Resume defaults ``one_line_per_bullet`` to False."""
    existing = (
        await db_session.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db_session.add(User(id=1))
        await db_session.flush()

    resume = Resume(
        user_id=1,
        kind="master",
        name="Lax Resume",
        template_id="jakes",
        latex_source="\\documentclass{article}\\begin{document}x\\end{document}",
        protected_terms=[],
    )
    db_session.add(resume)
    await db_session.flush()
    await db_session.refresh(resume)

    assert resume.one_line_per_bullet is False


@pytest.mark.asyncio
async def test_raw_insert_omitting_column_uses_server_default_true(db_session):
    """Raw INSERT without the column receives the server default (True)."""
    existing = (
        await db_session.execute(select(User).where(User.id == 1))
    ).scalar_one_or_none()
    if existing is None:
        db_session.add(User(id=1))
        await db_session.flush()

    await db_session.execute(
        text(
            "INSERT INTO resumes "
            "(user_id, kind, name, template_id, latex_source, protected_terms) "
            "VALUES (:user_id, :kind, :name, :template_id, :latex, :pt)"
        ),
        {
            "user_id": 1,
            "kind": "master",
            "name": "Legacy Resume",
            "template_id": "jakes",
            "latex": "\\documentclass{article}\\begin{document}x\\end{document}",
            "pt": "[]",
        },
    )
    await db_session.flush()

    row = (
        await db_session.execute(
            select(Resume).where(Resume.name == "Legacy Resume")
        )
    ).scalar_one()
    assert row.one_line_per_bullet is True
