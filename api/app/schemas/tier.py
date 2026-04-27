from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


TierSlug = Literal["dream", "targeted", "wide_net", "skip"]
TierMode = Literal["A", "B"]
TailorModel = Literal["sonnet-4.6", "opus-4.7", "haiku-4.5"]


class TierOut(BaseModel):
    id: int
    slug: str
    display_name: str
    min_fit_score: int
    daily_cap: int
    default_mode: TierMode
    tailor_model: TailorModel
    classify_model: str
    enabled: bool
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class TierUpdate(BaseModel):
    """Mutable subset of a tier policy.

    `slug` and `min_fit_score` are intentionally immutable in v1 — changing
    thresholds would retroactively reshuffle classified postings, which the
    pipeline does not currently handle.
    """

    daily_cap: int | None = None
    default_mode: TierMode | None = None
    tailor_model: TailorModel | None = None
    enabled: bool | None = None

    model_config = ConfigDict(extra="forbid")
