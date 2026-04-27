"""KB adapter for the user's master LaTeX resume.

Strips LaTeX commands to plain text via ``pylatexenc`` and feeds the result
through ``kb_ingest.ingest_document`` under ``source="latex_master"``.
"""

from __future__ import annotations

from pylatexenc.latex2text import LatexNodes2Text
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KbDocument, Resume
from app.services.kb_ingest import ingest_document


async def ingest(*, user_id: int, db: AsyncSession) -> KbDocument | None:
    """Ingest the most recent master Resume row for ``user_id``.

    Returns ``None`` when no master resume exists.
    """
    resume = (
        await db.execute(
            select(Resume)
            .where(Resume.user_id == user_id, Resume.parent_id.is_(None))
            .order_by(Resume.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if resume is None:
        return None

    plain = LatexNodes2Text().latex_to_text(resume.latex_source or "")
    return await ingest_document(
        db,
        user_id=user_id,
        source="latex_master",
        source_id=str(resume.id),
        title="Master Resume",
        raw_text=plain,
        meta={"resume_id": resume.id},
    )
