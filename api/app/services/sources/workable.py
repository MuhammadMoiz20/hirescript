"""Workable Apply API fetcher + normalizer.

Workable exposes two public, unauthenticated JSON endpoints:

    GET https://apply.workable.com/api/v1/widget/accounts/<slug>
        -> {"jobs": [{shortcode, title, location, ...}, ...]}

    GET https://apply.workable.com/api/v3/accounts/<slug>/jobs/<shortcode>
        -> full posting (description, requirements, benefits, ...)

Listing returns lightweight stubs; we hit the v3 detail endpoint per
posting to populate description / apply_url. Fan-out is bounded by the
size of a single company board (typically <100 postings).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.sources.greenhouse import _strip_html
from app.services.sources.protocol import NormalizedPosting

__all__ = [
    "WorkableSource",
    "workable_source",
    "WORKABLE_LIST_URL",
    "WORKABLE_DETAIL_URL",
]


WORKABLE_LIST_URL = "https://apply.workable.com/api/v1/widget/accounts"
WORKABLE_DETAIL_URL = "https://apply.workable.com/api/v3/accounts"


# Recognized URL family:
#   https://apply.workable.com/<slug>/j/<shortcode>/[apply/]
_WORKABLE_HOST = "apply.workable.com"
_WORKABLE_PATH_RE = re.compile(
    r"^/(?P<slug>[a-z0-9\-]+)/j/(?P<shortcode>[A-Za-z0-9]+)(?:/.*)?$",
    re.I,
)


def _format_location(loc: Any) -> str | None:
    if loc is None:
        return None
    if isinstance(loc, str):
        return loc or None
    if isinstance(loc, dict):
        parts = [
            loc.get("city"),
            loc.get("region"),
            loc.get("country"),
        ]
        joined = ", ".join(p for p in parts if p)
        return joined or None
    return None


def _normalize_one(
    raw: dict[str, Any], *, slug: str
) -> NormalizedPosting:
    """Map a single Workable v3 job entry into our normalized shape."""
    shortcode = raw.get("shortcode") or raw.get("id") or ""
    description_html = raw.get("description") or ""
    # Concatenate the requirements + benefits sections so the classifier sees
    # the full posting text, not just the lede.
    extra_html = []
    if raw.get("requirements"):
        extra_html.append(str(raw["requirements"]))
    if raw.get("benefits"):
        extra_html.append(str(raw["benefits"]))
    full_html = description_html + "\n".join(extra_html) if extra_html else (
        description_html or None
    )
    description_text = _strip_html(full_html) or ""
    apply_url = (
        raw.get("application_url")
        or raw.get("url")
        or f"https://apply.workable.com/{slug}/j/{shortcode}/"
    )

    return NormalizedPosting(
        source_job_id=str(shortcode),
        title=raw.get("title") or "",
        location=_format_location(raw.get("location")),
        apply_url=apply_url,
        description_html=full_html,
        description_text=description_text,
        meta={
            "workable_shortcode": str(shortcode),
            "department": raw.get("department"),
            "employment_type": raw.get("employment_type"),
            "industry": raw.get("industry"),
        },
    )


def _parse_workable_url(url: str) -> tuple[str, str] | None:
    """Return ``(slug, shortcode)`` if ``url`` is a Workable posting URL."""
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if (p.netloc or "").lower() != _WORKABLE_HOST:
        return None
    m = _WORKABLE_PATH_RE.match(p.path or "")
    if m is None:
        return None
    return m.group("slug"), m.group("shortcode")


async def _fetch_list(
    slug: str, *, http: httpx.AsyncClient
) -> list[dict[str, Any]]:
    url = f"{WORKABLE_LIST_URL}/{slug}"
    try:
        resp = await http.get(url)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return []
        raise
    payload = resp.json() or {}
    jobs = payload.get("jobs") or []
    return [j for j in jobs if isinstance(j, dict)]


async def _fetch_detail(
    slug: str, shortcode: str, *, http: httpx.AsyncClient
) -> dict[str, Any]:
    url = f"{WORKABLE_DETAIL_URL}/{slug}/jobs/{shortcode}"
    resp = await http.get(url)
    resp.raise_for_status()
    return resp.json() or {}


class WorkableSource:
    """:class:`Source` adapter for the public Workable Apply API."""

    name = "workable"
    tos_risk = "clean"

    async def fetch_company_postings(
        self, slug: str, *, http: httpx.AsyncClient
    ) -> list[NormalizedPosting]:
        stubs = await _fetch_list(slug, http=http)
        if not stubs:
            return []

        async def _expand(stub: dict[str, Any]) -> NormalizedPosting | None:
            shortcode = stub.get("shortcode") or stub.get("id")
            if not shortcode:
                return None
            try:
                detail = await _fetch_detail(
                    slug, str(shortcode), http=http
                )
            except httpx.HTTPStatusError:
                # Best-effort per posting — fall back to the list stub.
                detail = stub
            # Merge stub into detail so list-only fields (e.g. url) survive.
            merged = {**stub, **detail}
            return _normalize_one(merged, slug=slug)

        results = await asyncio.gather(
            *(_expand(s) for s in stubs), return_exceptions=False
        )
        return [r for r in results if r is not None]

    def matches_url(self, url: str) -> bool:
        return _parse_workable_url(url) is not None

    def slug_from_url(self, url: str) -> str:
        parsed = _parse_workable_url(url)
        if parsed is None:
            raise ValueError(f"not a workable posting URL: {url!r}")
        return parsed[0]

    async def fetch_one_url(
        self, url: str, *, http: httpx.AsyncClient
    ) -> NormalizedPosting:
        parsed = _parse_workable_url(url)
        if parsed is None:
            raise ValueError(f"not a workable posting URL: {url!r}")
        slug, shortcode = parsed
        detail = await _fetch_detail(slug, shortcode, http=http)
        return _normalize_one(detail, slug=slug)


workable_source = WorkableSource()
