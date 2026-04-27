"""Tier policy CRUD routes.

`GET /tiers` returns all four canonical tier rows ordered by
``min_fit_score`` descending (dream → skip). `PATCH /tiers/{slug}`
mutates the editable subset (`daily_cap`, `default_mode`,
`tailor_model`, `enabled`); `slug` and `min_fit_score` are immutable
in v1.

All routes are gated by ``require_user``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_db
from app.models import Tier
from app.schemas.tier import TierOut, TierUpdate

router = APIRouter(prefix="/tiers", tags=["tiers"])


@router.get("", response_model=list[TierOut])
async def list_tiers(
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(select(Tier).order_by(Tier.min_fit_score.desc()))
    ).scalars().all()
    return rows


@router.patch("/{slug}", response_model=TierOut)
async def patch_tier(
    slug: str,
    patch: TierUpdate,
    user_id: int = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    tier = (
        await db.execute(select(Tier).where(Tier.slug == slug))
    ).scalar_one_or_none()
    if tier is None:
        raise HTTPException(status_code=404, detail="Unknown tier slug")

    updates = patch.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(tier, key, value)
    await db.commit()
    await db.refresh(tier)
    return tier
