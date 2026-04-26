"""Knowledge-base sources/documents API routes.

Slice 1 keeps sync ingestion request-blocking; the worker queue lands in
slice 3. Endpoints are gated by ``require_user`` and scoped to that user's
documents.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import KbChunk, KbDocument
from app.services.kb_sources import latex_master, markdown_folder

router = APIRouter(prefix="/kb", tags=["kb"])

KNOWN_SOURCES = ["latex_master", "markdown"]
_MAX_LIMIT = 200


# TODO(perf): collapse the per-source loop into a single grouped query
# (select source, count(distinct doc_id), count(chunk.id), max(fetched_at)
#  outer-join kb_chunks group_by source) once we have >2 sources or
# >hundreds of documents. With 2 sources today this is fine.
async def _source_counts(db: AsyncSession, user_id: int, source: str) -> tuple[int, int]:
    """Return (document_count, chunk_count) for a single source."""
    doc_count = (
        await db.execute(
            select(func.count(KbDocument.id)).where(
                KbDocument.user_id == user_id, KbDocument.source == source
            )
        )
    ).scalar_one()
    # Two-query aggregation: doc count, then chunk count joined back.
    # TODO(slice-3): a concurrent ingest between the two queries could skew
    # the chunk total. Currently safe — request-blocking, single user, no
    # worker queue.
    chunk_count = (
        await db.execute(
            select(func.count(KbChunk.id))
            .join(KbDocument, KbChunk.document_id == KbDocument.id)
            .where(KbDocument.user_id == user_id, KbDocument.source == source)
        )
    ).scalar_one()
    return int(doc_count or 0), int(chunk_count or 0)


@router.get("/sources")
async def list_sources(
    user_id: int = Depends(require_user), db: AsyncSession = Depends(get_db)
):
    out = []
    for source in KNOWN_SOURCES:
        doc_count, chunk_count = await _source_counts(db, user_id, source)
        last_synced = (
            await db.execute(
                select(func.max(KbDocument.fetched_at)).where(
                    KbDocument.user_id == user_id, KbDocument.source == source
                )
            )
        ).scalar_one()
        out.append(
            {
                "source": source,
                "document_count": doc_count,
                "chunk_count": chunk_count,
                "last_synced_at": last_synced.isoformat() if last_synced else None,
            }
        )
    return out


@router.post("/sources/{source}/sync")
async def sync_source(
    source: str,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    if source not in KNOWN_SOURCES:
        raise HTTPException(status_code=404, detail="Unknown source")

    extra: dict = {}
    if source == "latex_master":
        await latex_master.ingest(user_id=user_id, db=db)
    elif source == "markdown":
        result = await markdown_folder.ingest(user_id=user_id, db=db)
        extra = {
            "created_or_updated": int(result.get("created_or_updated", 0)),
            "deleted": int(result.get("deleted", 0)),
        }

    doc_count, chunk_count = await _source_counts(db, user_id, source)
    return {
        "source": source,
        "document_count": doc_count,
        "chunk_count": chunk_count,
        **extra,
    }


@router.get("/documents")
async def list_documents(
    source: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    base = select(KbDocument).where(KbDocument.user_id == user_id)
    if source is not None:
        base = base.where(KbDocument.source == source)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    rows = (
        await db.execute(
            base.order_by(KbDocument.fetched_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()

    items: list[dict] = []
    if rows:
        ids = [d.id for d in rows]
        chunk_rows = (
            await db.execute(
                select(KbChunk.document_id, func.count(KbChunk.id))
                .where(KbChunk.document_id.in_(ids))
                .group_by(KbChunk.document_id)
            )
        ).all()
        chunk_map = {doc_id: int(c) for doc_id, c in chunk_rows}
        for d in rows:
            items.append(
                {
                    "id": d.id,
                    "source": d.source,
                    "source_id": d.source_id,
                    "title": d.title,
                    "fetched_at": d.fetched_at.isoformat() if d.fetched_at else None,
                    "chunk_count": chunk_map.get(d.id, 0),
                    "hash": d.hash,
                }
            )

    return {"items": items, "total": int(total or 0)}


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: int,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # NOTE: SELECT unfiltered then compare user_id so cross-tenant ids return 403
    # (not 404). Do not collapse into a user_id-filtered SELECT — that would leak
    # the 404/403 distinction.
    doc = (
        await db.execute(select(KbDocument).where(KbDocument.id == doc_id))
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Not found")
    if doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    await db.execute(sa_delete(KbDocument).where(KbDocument.id == doc_id))
    await db.commit()
    return Response(status_code=204)
