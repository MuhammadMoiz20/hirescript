"""Lever Postings API fetcher + normalizer.

Lever exposes a public, unauthenticated JSON board per company:

    GET https://api.lever.co/v0/postings/<slug>?mode=json

Per-posting:

    GET https://api.lever.co/v0/postings/<slug>/<id>?mode=json

Schema reference: https://github.com/lever/postings-api

Mirrors the Greenhouse adapter shape: a 404 means "no jobs to ingest
right now" so the scheduler keeps making progress on the rest of the
allowlist.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.sources.greenhouse import _strip_html
from app.services.sources.protocol import CoverLetterRequirement, NormalizedPosting

__all__ = [
    "LeverSource",
    "lever_source",
    "LEVER_BASE_URL",
]


LEVER_BASE_URL = "https://api.lever.co/v0/postings"


# Recognized URL families:
#   https://jobs.lever.co/<slug>/<id>[/apply]
#   https://lever.co/jobs/<slug>/<id>
_LEVER_JOBS_HOST = "jobs.lever.co"
_LEVER_ALT_HOST = "lever.co"
# Lever ids look like UUIDs (with dashes) or short hex slugs; allow word chars + dashes.
_LEVER_JOBS_PATH_RE = re.compile(
    r"^/(?P<slug>[a-z0-9\-]+)/(?P<jid>[A-Za-z0-9\-]+)(?:/apply)?/?$",
    re.I,
)
_LEVER_ALT_PATH_RE = re.compile(
    r"^/jobs/(?P<slug>[a-z0-9\-]+)/(?P<jid>[A-Za-z0-9\-]+)/?$",
    re.I,
)


def _normalize_one(raw: dict[str, Any]) -> NormalizedPosting:
    """Map a single Lever posting into our normalized shape."""
    posting_id = raw.get("id") or ""
    categories = raw.get("categories") or {}
    location = None
    if isinstance(categories, dict):
        loc = categories.get("location")
        if isinstance(loc, str) and loc:
            location = loc

    description_html = raw.get("description")
    description_text = (
        raw.get("descriptionPlain")
        or _strip_html(description_html)
        or ""
    )
    apply_url = (
        raw.get("hostedUrl")
        or raw.get("applyUrl")
        or ""
    )

    return NormalizedPosting(
        source_job_id=str(posting_id),
        title=raw.get("text") or "",
        location=location,
        apply_url=apply_url,
        description_html=description_html,
        description_text=description_text,
        meta={
            "lever_id": str(posting_id),
            "categories": categories if isinstance(categories, dict) else {},
        },
    )


def _parse_lever_url(url: str) -> tuple[str, str] | None:
    """Return ``(slug, posting_id)`` if ``url`` is a Lever posting URL."""
    try:
        p = urlparse(url)
    except ValueError:
        return None
    host = (p.netloc or "").lower()
    if host == _LEVER_JOBS_HOST:
        m = _LEVER_JOBS_PATH_RE.match(p.path or "")
        if m is None:
            return None
        return m.group("slug"), m.group("jid")
    if host == _LEVER_ALT_HOST:
        m = _LEVER_ALT_PATH_RE.match(p.path or "")
        if m is None:
            return None
        return m.group("slug"), m.group("jid")
    return None


async def _fetch_company_postings(
    slug: str, *, http: httpx.AsyncClient
) -> list[NormalizedPosting]:
    url = f"{LEVER_BASE_URL}/{slug}"
    try:
        resp = await http.get(url, params={"mode": "json"})
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return []
        raise
    payload = resp.json() or []
    if not isinstance(payload, list):
        return []
    return [_normalize_one(j) for j in payload if isinstance(j, dict)]


class LeverSource:
    """:class:`Source` adapter for the public Lever Postings API."""

    name = "lever"
    tos_risk = "clean"

    async def fetch_company_postings(
        self, slug: str, *, http: httpx.AsyncClient
    ) -> list[NormalizedPosting]:
        return await _fetch_company_postings(slug, http=http)

    def matches_url(self, url: str) -> bool:
        return _parse_lever_url(url) is not None

    def slug_from_url(self, url: str) -> str:
        parsed = _parse_lever_url(url)
        if parsed is None:
            raise ValueError(f"not a lever posting URL: {url!r}")
        return parsed[0]

    async def fetch_one_url(
        self, url: str, *, http: httpx.AsyncClient
    ) -> NormalizedPosting:
        parsed = _parse_lever_url(url)
        if parsed is None:
            raise ValueError(f"not a lever posting URL: {url!r}")
        slug, posting_id = parsed
        api_url = f"{LEVER_BASE_URL}/{slug}/{posting_id}"
        resp = await http.get(api_url, params={"mode": "json"})
        resp.raise_for_status()
        raw = resp.json() or {}
        if isinstance(raw, list):
            # Some endpoints wrap a single posting in a list; pick the first.
            raw = raw[0] if raw else {}
        return _normalize_one(raw)

    async def probe_cover_letter(
        self,
        posting_meta: dict[str, Any],
        apply_url: str,
        *,
        http: httpx.AsyncClient,
    ) -> CoverLetterRequirement:
        return CoverLetterRequirement.UNKNOWN


lever_source = LeverSource()
