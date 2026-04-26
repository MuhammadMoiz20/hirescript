"""Knowledge-base ingest service.

Provides ``ingest_document``: a hash-aware upsert that stores a ``KbDocument``
plus its chunked + embedded ``KbChunk`` rows. Source-specific adapters under
``app.services.kb_sources`` build on top of this.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KbChunk, KbDocument
from app.services.chunking import chunk_markdown
from app.services.embeddings import embed


async def ingest_document(
    db: AsyncSession,
    *,
    user_id: int,
    source: str,
    source_id: str,
    title: str,
    raw_text: str,
    meta: dict | None = None,
) -> KbDocument:
    """Upsert a KB document and its chunks.

    No-ops when the existing row's hash matches the new content hash. Otherwise
    deletes the existing chunks (CASCADE keeps things tidy if we replaced the
    parent row, but we update in place to preserve the document id) and
    re-chunks + re-embeds the new content.
    """
    meta = meta or {}
    digest = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()

    existing = (
        await db.execute(
            select(KbDocument).where(
                KbDocument.user_id == user_id,
                KbDocument.source == source,
                KbDocument.source_id == source_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None and existing.hash == digest:
        return existing

    if existing is None:
        doc = KbDocument(
            user_id=user_id,
            source=source,
            source_id=source_id,
            title=title,
            raw_text=raw_text,
            meta=meta,
            hash=digest,
        )
        db.add(doc)
        await db.flush()
    else:
        existing.title = title
        existing.raw_text = raw_text
        existing.meta = meta
        existing.hash = digest
        existing.fetched_at = datetime.now(timezone.utc)
        await db.execute(delete(KbChunk).where(KbChunk.document_id == existing.id))
        await db.flush()
        doc = existing

    chunks = chunk_markdown(raw_text)
    if chunks:
        vectors = await embed([c["text"] for c in chunks])
        for c, vec in zip(chunks, vectors):
            db.add(
                KbChunk(
                    document_id=doc.id,
                    chunk_index=c["index"],
                    text=c["text"],
                    token_count=c["token_count"],
                    embedding=vec,
                    meta={"heading": c["meta"].get("heading")},
                )
            )

    await db.commit()
    await db.refresh(doc)
    return doc
