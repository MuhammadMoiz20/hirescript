"""KB adapter for a manually maintained markdown folder.

Walks ``root`` for ``*.md`` files, ingests each via ``kb_ingest.ingest_document``
under ``source="markdown"`` and ``source_id=<relative posix path>``, and deletes
any previously ingested markdown documents whose files no longer exist.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KbDocument
from app.services.kb_ingest import ingest_document


def _title_from(text: str, fallback: str) -> str:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip() or fallback
    return fallback


async def ingest(
    *, user_id: int, db: AsyncSession, root: str = "/app/kb"
) -> dict:
    """Sync the markdown folder at ``root`` into the KB.

    Returns ``{"created_or_updated": N, "deleted": M}``.
    """
    root_path = Path(root)
    if not root_path.exists() or not root_path.is_dir():
        return {"created_or_updated": 0, "deleted": 0}

    seen: set[str] = set()
    created_or_updated = 0
    for md in sorted(root_path.rglob("*.md")):
        if not md.is_file():
            continue
        rel = md.relative_to(root_path).as_posix()
        seen.add(rel)
        raw_text = md.read_text(encoding="utf-8")
        title = _title_from(raw_text, md.stem)
        await ingest_document(
            db,
            user_id=user_id,
            source="markdown",
            source_id=rel,
            title=title,
            raw_text=raw_text,
            meta={"path": rel},
        )
        created_or_updated += 1

    existing = (
        await db.execute(
            select(KbDocument).where(
                KbDocument.user_id == user_id, KbDocument.source == "markdown"
            )
        )
    ).scalars().all()
    stale_ids = [d.id for d in existing if d.source_id not in seen]
    if stale_ids:
        await db.execute(delete(KbDocument).where(KbDocument.id.in_(stale_ids)))
        await db.commit()

    return {"created_or_updated": created_or_updated, "deleted": len(stale_ids)}
