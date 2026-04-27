"""KB adapter for crawling a personal website (slice 5 task 14).

Async crawler over a single root URL. Honours ``robots.txt`` (cached per
host for the duration of one sync), follows in-host links only, applies
optional allow/deny URL-substring patterns, renders each page's text to
markdown-ish plain content via BeautifulSoup, and upserts each page into
``kb_documents`` keyed by ``(source="website", source_id=<absolute_url>)``.
Pages no longer reachable on a re-crawl are purged from the KB.

The crawler is dependency-frugal: it uses ``httpx`` (already vendored)
plus ``BeautifulSoup`` (already vendored) — no extra package required.
"""

from __future__ import annotations

import logging
import os
import re
from collections import deque
from typing import Protocol
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KbDocument
from app.services.kb_ingest import ingest_document

log = logging.getLogger(__name__)


class FetcherProtocol(Protocol):
    async def get(self, url: str) -> tuple[int, str, str]: ...


class HttpxFetcher:
    """Default :class:`FetcherProtocol` impl — single shared client."""

    def __init__(self, *, timeout: float = 15.0) -> None:
        self._timeout = timeout

    async def get(self, url: str) -> tuple[int, str, str]:
        async with httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
            headers={"User-Agent": "HireScriptKB/1.0"},
        ) as http:
            try:
                r = await http.get(url)
            except httpx.HTTPError:
                return (0, "", "")
            ct = r.headers.get("content-type", "").split(";", 1)[0].strip()
            return (r.status_code, ct, r.text)


def _parse_robots(body: str) -> list[str]:
    """Extract Disallow paths for ``User-agent: *`` (very small subset)."""
    disallows: list[str] = []
    in_star = False
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if key == "user-agent":
            in_star = value == "*"
        elif in_star and key == "disallow" and value:
            disallows.append(value)
    return disallows


def _matches_any(path: str, patterns: list[str]) -> bool:
    return any(p and p in path for p in patterns)


def _render_text(html: str) -> tuple[str, str]:
    """Return ``(title, body_text)`` from raw HTML."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    title = (soup.title.string.strip() if soup.title and soup.title.string else "")
    text = soup.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return title, text


def _normalize(url: str) -> str:
    url, _ = urldefrag(url)
    return url


def root_urls_from_env() -> list[str]:
    raw = os.environ.get("WEBSITE_ROOT_URLS", "")
    return [u.strip() for u in raw.split(",") if u.strip()]


async def ingest(
    *,
    user_id: int,
    db: AsyncSession,
    root_url: str,
    fetcher: FetcherProtocol | None = None,
    allow_patterns: list[str] | None = None,
    deny_patterns: list[str] | None = None,
    max_pages: int = 50,
) -> dict:
    """Crawl ``root_url`` and upsert reachable pages into ``kb_documents``.

    Same-host only. Honours ``robots.txt`` via a tiny ``User-agent: *``
    parser. ``allow_patterns`` / ``deny_patterns`` are simple substring
    matches against the URL path.

    Returns ``{"created_or_updated": N, "deleted": M}``.
    """
    if not root_url:
        return {"created_or_updated": 0, "deleted": 0}
    fetcher = fetcher or HttpxFetcher()
    allow_patterns = list(allow_patterns or [])
    deny_patterns = list(deny_patterns or [])

    parsed_root = urlparse(root_url)
    host = parsed_root.netloc
    robots_url = f"{parsed_root.scheme}://{host}/robots.txt"

    disallows: list[str] = []
    try:
        status, _ct, body = await fetcher.get(robots_url)
        if status == 200 and body:
            disallows = _parse_robots(body)
    except Exception:  # noqa: BLE001
        log.warning("website: robots.txt fetch failed for %s", host)

    seen: set[str] = set()
    queue: deque[str] = deque([root_url])
    created_or_updated = 0

    while queue and len(seen) < max_pages:
        url = queue.popleft()
        url = _normalize(url)
        if url in seen:
            continue
        parsed = urlparse(url)
        if parsed.netloc and parsed.netloc != host:
            continue
        path = parsed.path or "/"
        if _matches_any(path, disallows):
            continue
        if allow_patterns and not _matches_any(path, allow_patterns):
            continue
        if deny_patterns and _matches_any(path, deny_patterns):
            continue

        try:
            status, ct, body = await fetcher.get(url)
        except Exception:  # noqa: BLE001
            log.exception("website: fetch failed for %s", url)
            continue
        if status != 200 or "html" not in ct:
            continue

        seen.add(url)
        title, text = _render_text(body)
        if not title:
            title = url
        await ingest_document(
            db,
            user_id=user_id,
            source="website",
            source_id=url,
            title=title,
            raw_text=text,
            meta={"url": url, "host": host},
        )
        created_or_updated += 1

        # Discover in-host links from this page.
        soup = BeautifulSoup(body, "html.parser")
        for a in soup.find_all("a", href=True):
            nxt = urljoin(url, a["href"])
            nxt, _ = urldefrag(nxt)
            if urlparse(nxt).netloc and urlparse(nxt).netloc != host:
                continue
            if nxt not in seen:
                queue.append(nxt)

    # Purge previously-ingested pages that are no longer reachable.
    existing = (
        await db.execute(
            select(KbDocument).where(
                KbDocument.user_id == user_id, KbDocument.source == "website"
            )
        )
    ).scalars().all()
    stale_ids = [d.id for d in existing if d.source_id not in seen]
    if stale_ids:
        await db.execute(delete(KbDocument).where(KbDocument.id.in_(stale_ids)))
        await db.commit()

    return {"created_or_updated": created_or_updated, "deleted": len(stale_ids)}
