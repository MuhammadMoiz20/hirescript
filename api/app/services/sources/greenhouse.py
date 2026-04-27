"""Greenhouse Job Board API fetcher + normalizer + upsert.

Greenhouse exposes a public, unauthenticated JSON board per company:

    GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true

Schema reference: https://developers.greenhouse.io/job-board.html

We treat the slug allowlist as advisory only — a slug that 404s is
treated as "no jobs to ingest right now" rather than a hard error so the
scheduler keeps making progress on the rest of the allowlist.
"""

from __future__ import annotations

from typing import Any, TypedDict

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import JobPosting


GREENHOUSE_BASE_URL = "https://boards-api.greenhouse.io/v1/boards"


class NormalizedPosting(TypedDict):
    """Source-agnostic posting payload used by the upsert layer."""

    source_job_id: str
    title: str
    location: str | None
    apply_url: str
    description_html: str | None
    description_text: str
    meta: dict[str, Any]


def _strip_html(html: str | None) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    # Insert a newline after block-level tags so paragraphs stay separated.
    for tag in soup.find_all(["p", "li", "br", "div", "h1", "h2", "h3", "h4", "tr"]):
        tag.append("\n")
    text = soup.get_text("", strip=False)
    # Collapse runs of whitespace within a line; collapse runs of blank lines.
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n\n".join(lines)


def _normalize_one(raw: dict[str, Any]) -> NormalizedPosting:
    """Map a single Greenhouse ``jobs[*]`` entry into our normalized shape."""
    gh_id = raw.get("id")
    location = None
    loc = raw.get("location")
    if isinstance(loc, dict):
        location = loc.get("name") or None

    departments = [
        d.get("name") for d in (raw.get("departments") or []) if isinstance(d, dict)
    ]
    offices = [
        o.get("name") for o in (raw.get("offices") or []) if isinstance(o, dict)
    ]

    description_html = raw.get("content")
    description_text = _strip_html(description_html)

    return NormalizedPosting(
        source_job_id=str(gh_id),
        title=raw.get("title") or "",
        location=location,
        apply_url=raw.get("absolute_url") or "",
        description_html=description_html,
        description_text=description_text,
        meta={
            "greenhouse_id": gh_id,
            "departments": [d for d in departments if d],
            "offices": [o for o in offices if o],
        },
    )


async def fetch_company_jobs(
    slug: str, *, http: httpx.AsyncClient
) -> list[NormalizedPosting]:
    """Fetch + normalize the Greenhouse job board for ``slug``.

    Returns ``[]`` when the board does not exist (404). Re-raises any other
    HTTP error so the caller can decide whether to retry.
    """
    url = f"{GREENHOUSE_BASE_URL}/{slug}/jobs"
    try:
        resp = await http.get(url, params={"content": "true"})
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return []
        raise
    payload = resp.json() or {}
    jobs = payload.get("jobs") or []
    return [_normalize_one(j) for j in jobs if isinstance(j, dict)]


# TODO(slice-2): the current SELECT-then-INSERT/UPDATE pattern is race-free under
# the slice-2 single-writer assumption (one scheduler, one ingest job per slug
# at a time). Once Task 13 adds manual sync routes that can race with the
# cron, switch the INSERT branch to `INSERT … ON CONFLICT (user_id, source,
# source_job_id) DO UPDATE` (Postgres-only) or wrap the SQLAlchemy add in
# try/except IntegrityError + retry. Slice-2 routes will not race today.
async def upsert_postings(
    db: AsyncSession,
    *,
    user_id: int,
    company_id: int | None,
    source: str,
    postings: list[NormalizedPosting],
) -> dict[str, int]:
    """Insert / update normalized postings for ``(user_id, source)``.

    Identity is ``(user_id, source, source_job_id)`` — guarded by the
    ``uq_job_postings_user_source_job`` unique constraint added in
    migration ``0009``. A row is considered ``unchanged`` (no DB write)
    when ``title``, ``description_text``, ``apply_url`` and ``location``
    all match the existing row.

    Returns ``{"created": N, "updated": M, "unchanged": K,
    "created_ids": [...], "updated_ids": [...], "unchanged_ids": [...]}``.
    The ``_ids`` lists let the runner enqueue follow-up classification jobs
    for newly-created postings without a re-query.
    """
    counts: dict[str, Any] = {
        "created": 0,
        "updated": 0,
        "unchanged": 0,
        "created_ids": [],
        "updated_ids": [],
        "unchanged_ids": [],
    }

    pending_new: list[JobPosting] = []

    for p in postings:
        existing = (
            await db.execute(
                select(JobPosting).where(
                    JobPosting.user_id == user_id,
                    JobPosting.source == source,
                    JobPosting.source_job_id == p["source_job_id"],
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            row = JobPosting(
                user_id=user_id,
                source=source,
                source_job_id=p["source_job_id"],
                company_id=company_id,
                title=p["title"],
                location=p["location"],
                apply_url=p["apply_url"],
                description_html=p["description_html"],
                description_text=p["description_text"],
                meta=p["meta"],
            )
            db.add(row)
            pending_new.append(row)
            counts["created"] += 1
            continue

        unchanged = (
            existing.title == p["title"]
            and existing.description_text == p["description_text"]
            and existing.apply_url == p["apply_url"]
            and existing.location == p["location"]
        )
        if unchanged:
            counts["unchanged"] += 1
            counts["unchanged_ids"].append(existing.id)
            continue

        existing.title = p["title"]
        existing.description_text = p["description_text"]
        existing.description_html = p["description_html"]
        existing.apply_url = p["apply_url"]
        existing.location = p["location"]
        existing.meta = p["meta"]
        if company_id is not None and existing.company_id is None:
            existing.company_id = company_id
        counts["updated"] += 1
        counts["updated_ids"].append(existing.id)

    # Flush so we get autogenerated ids for newly-inserted rows.
    if pending_new:
        await db.flush()
        for row in pending_new:
            counts["created_ids"].append(row.id)

    await db.commit()
    return counts
