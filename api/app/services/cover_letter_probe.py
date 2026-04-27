"""Resolve a posting's cover-letter requirement, caching the result in meta.

The first prepare for a posting calls the source-specific probe; subsequent
prepares (e.g., user retried after edits) read from
``job_postings.meta["cover_letter"]`` for free.

Probes promise not to raise (per the Source protocol contract), but this
resolver wraps the call defensively anyway -- a buggy probe must never block
the prepare pipeline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models import JobPosting
from app.services.sources import SOURCES
from app.services.sources.protocol import CoverLetterRequirement

log = logging.getLogger(__name__)


async def resolve_cover_letter_requirement(
    db: AsyncSession, posting: JobPosting
) -> CoverLetterRequirement:
    """Return the cached requirement, probing if absent. Never raises."""
    cached = (posting.meta or {}).get("cover_letter") or {}
    cached_value = cached.get("requirement")
    if cached_value:
        try:
            return CoverLetterRequirement(cached_value)
        except ValueError:
            pass  # corrupt cache -> re-probe

    source = SOURCES.get(posting.source)
    if source is None:
        return CoverLetterRequirement.UNKNOWN

    async with httpx.AsyncClient() as http:
        try:
            requirement = await source.probe_cover_letter(
                dict(posting.meta or {}), posting.apply_url, http=http,
            )
        except Exception:
            log.exception("probe_cover_letter raised for posting %s", posting.id)
            requirement = CoverLetterRequirement.UNKNOWN

    posting.meta = {
        **(posting.meta or {}),
        "cover_letter": {
            "requirement": requirement.value,
            "probed_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    flag_modified(posting, "meta")
    await db.commit()
    return requirement
