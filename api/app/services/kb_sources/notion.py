"""KB adapter for Notion (slice 5 task 13).

Uses the official Notion REST API via ``httpx`` (no extra dep required).
The user supplies an integration token via the ``NOTION_TOKEN`` env var
and a list of page (or database) IDs to sync. We walk each scoped root,
fetch its blocks, render to markdown, and upsert into ``kb_documents``
keyed by ``(source="notion", source_id=<page_id>)``. Pages no longer in
the configured set are purged from the KB on the next sync.

The adapter is intentionally minimal: no whole-vault traversal, no
recursive child-page fetch, no databases-as-pages expansion. The user
explicitly lists the page IDs they want indexed.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Protocol

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KbDocument
from app.services.kb_ingest import ingest_document

log = logging.getLogger(__name__)


_NOTION_API = "https://api.notion.com/v1"
_NOTION_VERSION = "2022-06-28"


class NotionClientProtocol(Protocol):
    async def fetch_page(self, page_id: str) -> dict[str, Any]: ...
    async def fetch_blocks(self, page_id: str) -> list[dict[str, Any]]: ...


class NotionHTTPClient:
    """Tiny async wrapper around the Notion REST API.

    Kept dependency-free (httpx only) so the test fixture can swap it
    for a fake implementing :class:`NotionClientProtocol`.
    """

    def __init__(self, token: str) -> None:
        self._token = token
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": _NOTION_VERSION,
        }

    async def fetch_page(self, page_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(
                f"{_NOTION_API}/pages/{page_id}", headers=self._headers
            )
            r.raise_for_status()
            return r.json()

    async def fetch_blocks(self, page_id: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        cursor: str | None = None
        async with httpx.AsyncClient(timeout=30) as http:
            while True:
                params: dict[str, Any] = {"page_size": 100}
                if cursor:
                    params["start_cursor"] = cursor
                r = await http.get(
                    f"{_NOTION_API}/blocks/{page_id}/children",
                    headers=self._headers,
                    params=params,
                )
                r.raise_for_status()
                payload = r.json()
                out.extend(payload.get("results", []))
                if not payload.get("has_more"):
                    break
                cursor = payload.get("next_cursor")
                if not cursor:
                    break
        return out


def _rich_text(items: list[dict[str, Any]] | None) -> str:
    if not items:
        return ""
    return "".join(i.get("plain_text") or "" for i in items)


def _block_to_md(block: dict[str, Any]) -> str:
    btype = block.get("type")
    if not btype:
        return ""
    body = block.get(btype) or {}
    text = _rich_text(body.get("rich_text"))
    if btype == "paragraph":
        return text
    if btype.startswith("heading_"):
        try:
            level = int(btype.split("_", 1)[1])
        except ValueError:
            level = 1
        return f"{'#' * max(1, min(level, 6))} {text}"
    if btype == "bulleted_list_item":
        return f"- {text}"
    if btype == "numbered_list_item":
        return f"1. {text}"
    if btype == "to_do":
        checked = "x" if body.get("checked") else " "
        return f"- [{checked}] {text}"
    if btype == "quote":
        return f"> {text}"
    if btype == "code":
        lang = body.get("language") or ""
        return f"```{lang}\n{text}\n```"
    if btype == "divider":
        return "---"
    # Fallback: emit the plain text if any.
    return text


def _page_title(page: dict[str, Any]) -> str:
    props = page.get("properties") or {}
    for prop in props.values():
        if prop.get("type") == "title":
            t = _rich_text(prop.get("title"))
            if t:
                return t
    # Some database rows store the title under a known property name.
    title_prop = props.get("title") or props.get("Name")
    if title_prop:
        t = _rich_text(title_prop.get("title") or title_prop.get("rich_text"))
        if t:
            return t
    return page.get("id") or "Untitled"


def _render_markdown(blocks: list[dict[str, Any]]) -> str:
    lines = [_block_to_md(b) for b in blocks]
    return "\n\n".join(line for line in lines if line is not None)


def has_token() -> bool:
    return bool(os.environ.get("NOTION_TOKEN"))


def page_ids_from_env() -> list[str]:
    raw = os.environ.get("NOTION_PAGE_IDS", "")
    return [p.strip() for p in raw.split(",") if p.strip()]


async def ingest(
    *,
    user_id: int,
    db: AsyncSession,
    page_ids: list[str] | None = None,
    client: NotionClientProtocol | None = None,
) -> dict:
    """Sync ``page_ids`` from Notion into ``kb_documents``.

    Returns ``{"created_or_updated": N, "deleted": M}``. When no client is
    supplied and no ``NOTION_TOKEN`` env var is set, returns zero counts
    (the caller should treat this as a no-op).
    """
    page_ids = page_ids or []
    if client is None:
        token = os.environ.get("NOTION_TOKEN")
        if not token:
            return {"created_or_updated": 0, "deleted": 0}
        client = NotionHTTPClient(token)

    seen: set[str] = set()
    created_or_updated = 0
    for page_id in page_ids:
        try:
            page = await client.fetch_page(page_id)
            blocks = await client.fetch_blocks(page_id)
        except Exception:  # noqa: BLE001 — per-page failure is non-fatal
            log.exception("notion: fetch failed for page %s", page_id)
            continue
        title = _page_title(page)
        body = _render_markdown(blocks)
        await ingest_document(
            db,
            user_id=user_id,
            source="notion",
            source_id=page_id,
            title=title,
            raw_text=body,
            meta={"page_id": page_id},
        )
        seen.add(page_id)
        created_or_updated += 1

    existing = (
        await db.execute(
            select(KbDocument).where(
                KbDocument.user_id == user_id, KbDocument.source == "notion"
            )
        )
    ).scalars().all()
    stale_ids = [d.id for d in existing if d.source_id not in seen]
    if stale_ids:
        await db.execute(delete(KbDocument).where(KbDocument.id.in_(stale_ids)))
        await db.commit()

    return {"created_or_updated": created_or_updated, "deleted": len(stale_ids)}
