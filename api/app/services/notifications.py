"""Notification persistence + ntfy.sh push delivery.

Single-tenant: one configured ``NTFY_TOPIC`` env var. The topic is the only
piece of routing info — no per-user fan-out, no provider abstractions.

Delivery contract:
- Always insert the row first so the in-app drawer sees the notification
  even if the push fails.
- Best-effort POST to ``https://ntfy.sh/{topic}``. Network failures log and
  return; ``delivered_at`` stays ``None``.
- If ``NTFY_TOPIC`` is unset, persist the row and skip the POST.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification

logger = logging.getLogger(__name__)

_NTFY_BASE = "https://ntfy.sh"
_NTFY_TIMEOUT_SEC = 10.0


async def send(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    title: str,
    body: str,
    meta: dict[str, Any] | None = None,
) -> Notification:
    """Persist a :class:`Notification` and best-effort POST it to ntfy.

    Returns the persisted row (with ``delivered_at`` populated when the
    push succeeded). The DB write is committed before the POST so a
    crashing process never loses notifications.
    """
    row = Notification(
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        meta=dict(meta or {}),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        logger.info(
            "NTFY_TOPIC unset; skipping push for notification %s", row.id
        )
        return row

    url = f"{_NTFY_BASE}/{topic}"
    headers = {"Title": title}
    payload = body.encode("utf-8")
    try:
        async with httpx.AsyncClient(timeout=_NTFY_TIMEOUT_SEC) as client:
            resp = await client.post(url, content=payload, headers=headers)
            resp.raise_for_status()
        row.delivered_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(row)
    except Exception:  # noqa: BLE001 — push is best-effort
        logger.warning(
            "ntfy POST failed for notification %s; row remains undelivered",
            row.id,
            exc_info=True,
        )

    return row
