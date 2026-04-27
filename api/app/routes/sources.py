"""``GET /sources`` — small read-only route exposing the source registry.

The UI uses this to render the source filter chip group without
hardcoding the list of sources, and to show a "ToS risk" badge next to
sources tagged ``tos_risk="high"`` (the Playwright scrapers).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import require_user
from app.services.sources import SOURCES

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("")
async def list_sources(user_id: int = Depends(require_user)):
    out = []
    for name, src in SOURCES.items():
        out.append(
            {
                "name": name,
                "tos_risk": getattr(src, "tos_risk", "clean"),
            }
        )
    out.sort(key=lambda r: r["name"])
    return out
