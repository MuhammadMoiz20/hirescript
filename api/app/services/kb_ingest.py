"""Knowledge-base ingest service.

Provides ``ingest_document``: a hash-aware upsert that stores a ``KbDocument``
plus its chunked + embedded ``KbChunk`` rows. Source-specific adapters under
``app.services.kb_sources`` build on top of this.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import TypedDict

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KbChunk, KbDocument
from app.services import embeddings
from app.services.chunking import chunk_markdown
from app.services.embeddings import embed


class RetrievedChunk(TypedDict):
    text: str
    source: str
    title: str
    distance: float
    document_id: int
    chunk_index: int


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

    # TODO(slice-2): wrap in try/except IntegrityError to retry on the
    # `(user_id, source, source_id)` unique-constraint race when concurrent
    # worker tasks ingest the same document. Currently safe because slice-1
    # only invokes this from request handlers (one in-flight per user).
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
                    meta=dict(c["meta"]),
                )
            )

    await db.commit()
    await db.refresh(doc)
    return doc


async def retrieve(
    db: AsyncSession,
    *,
    user_id: int,
    query: str,
    k: int = 8,
    source_filter: list[str] | None = None,
) -> list[RetrievedChunk]:
    """Return the top-``k`` chunks most similar to ``query`` by cosine distance.

    Filters are scoped to ``user_id`` (single-tenant invariant) and optionally
    to a list of source names. Results include the parent document's ``source``
    and ``title`` plus the cosine distance for downstream re-ranking.
    """
    qvec = await embeddings.embed_query(query)
    distance = KbChunk.embedding.cosine_distance(qvec).label("distance")
    stmt = (
        select(KbChunk, KbDocument, distance)
        .join(KbDocument, KbChunk.document_id == KbDocument.id)
        .where(KbDocument.user_id == user_id)
    )
    if source_filter:
        stmt = stmt.where(KbDocument.source.in_(source_filter))
    stmt = stmt.order_by(distance).limit(k)
    rows = (await db.execute(stmt)).all()
    return [
        RetrievedChunk(
            text=chunk.text,
            source=doc.source,
            title=doc.title,
            distance=float(dist),
            document_id=chunk.document_id,
            chunk_index=chunk.chunk_index,
        )
        for chunk, doc, dist in rows
    ]
