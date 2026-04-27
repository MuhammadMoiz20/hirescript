"""Ashby Posting API fetcher + normalizer.

Ashby exposes a public, unauthenticated JSON job board per company:

    GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true

The endpoint returns ``{"jobs": [{...}]}``. The posting-api is
board-scoped — there is no per-posting URL — so :meth:`fetch_one_url`
fetches the whole board and finds the matching id. This is acceptable
for v1 because pasting a single Ashby URL is a low-frequency operation
and the board response stays small (<1MB for typical companies).
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.sources.greenhouse import _strip_html
from app.services.sources.protocol import CoverLetterRequirement, NormalizedPosting

__all__ = [
    "AshbySource",
    "ashby_source",
    "ASHBY_BASE_URL",
]


ASHBY_BASE_URL = "https://api.ashbyhq.com/posting-api/job-board"


# Recognized URL family:
#   https://jobs.ashbyhq.com/<slug>/<id>
# Ids may be UUIDs (with dashes) or short alphanumeric tokens.
_ASHBY_HOST = "jobs.ashbyhq.com"
_ASHBY_PATH_RE = re.compile(
    r"^/(?P<slug>[a-z0-9\-]+)/(?P<jid>[A-Za-z0-9\-]+)/?$",
    re.I,
)


def _normalize_one(raw: dict[str, Any]) -> NormalizedPosting:
    """Map a single Ashby ``jobs[*]`` entry into our normalized shape."""
    posting_id = raw.get("id") or ""
    description_html = raw.get("descriptionHtml")
    description_text = (
        raw.get("descriptionPlain")
        or _strip_html(description_html)
        or ""
    )
    location = raw.get("location") or None
    if isinstance(location, dict):
        # Some boards wrap location as an object — best-effort flatten.
        location = location.get("name") or None

    return NormalizedPosting(
        source_job_id=str(posting_id),
        title=raw.get("title") or "",
        location=location,
        apply_url=raw.get("jobUrl") or raw.get("applyUrl") or "",
        description_html=description_html,
        description_text=description_text,
        meta={
            "ashby_id": str(posting_id),
            "department": raw.get("department"),
            "team": raw.get("team"),
            "employment_type": raw.get("employmentType"),
        },
    )


def _parse_ashby_url(url: str) -> tuple[str, str] | None:
    """Return ``(slug, posting_id)`` if ``url`` is an Ashby posting URL."""
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if (p.netloc or "").lower() != _ASHBY_HOST:
        return None
    m = _ASHBY_PATH_RE.match(p.path or "")
    if m is None:
        return None
    return m.group("slug"), m.group("jid")


async def _fetch_board(
    slug: str, *, http: httpx.AsyncClient
) -> list[dict[str, Any]]:
    url = f"{ASHBY_BASE_URL}/{slug}"
    try:
        resp = await http.get(url, params={"includeCompensation": "true"})
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return []
        raise
    payload = resp.json() or {}
    jobs = payload.get("jobs") or []
    return [j for j in jobs if isinstance(j, dict)]


class AshbySource:
    """:class:`Source` adapter for the public Ashby job board API."""

    name = "ashby"
    tos_risk = "clean"

    async def fetch_company_postings(
        self, slug: str, *, http: httpx.AsyncClient
    ) -> list[NormalizedPosting]:
        jobs = await _fetch_board(slug, http=http)
        return [_normalize_one(j) for j in jobs]

    def matches_url(self, url: str) -> bool:
        return _parse_ashby_url(url) is not None

    def slug_from_url(self, url: str) -> str:
        parsed = _parse_ashby_url(url)
        if parsed is None:
            raise ValueError(f"not an ashby posting URL: {url!r}")
        return parsed[0]

    async def fetch_one_url(
        self, url: str, *, http: httpx.AsyncClient
    ) -> NormalizedPosting:
        parsed = _parse_ashby_url(url)
        if parsed is None:
            raise ValueError(f"not an ashby posting URL: {url!r}")
        slug, posting_id = parsed
        jobs = await _fetch_board(slug, http=http)
        for j in jobs:
            if str(j.get("id") or "") == posting_id:
                return _normalize_one(j)
        raise ValueError(
            f"ashby posting id {posting_id!r} not found on board {slug!r}"
        )

    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        return CoverLetterRequirement.UNKNOWN


ashby_source = AshbySource()
