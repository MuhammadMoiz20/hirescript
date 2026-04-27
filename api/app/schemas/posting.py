from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobPostingOut(BaseModel):
    id: int
    source: str
    source_job_id: str
    company: str | None = None  # display_name
    title: str
    location: str | None = None
    apply_url: str
    tier: str | None = None
    fit_score: int | None = None
    status: str
    ingested_at: datetime

    model_config = ConfigDict(from_attributes=True)


class JobPostingDetailOut(JobPostingOut):
    """Inbox-detail-drawer view: full description + classification context."""

    description_text: str
    description_html: str | None = None
    meta: dict = {}
    canonical_key: str | None = None
    classification_rationale: str | None = None


class PostingListOut(BaseModel):
    items: list[JobPostingOut]
    total: int
