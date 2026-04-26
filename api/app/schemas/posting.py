from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobPostingOut(BaseModel):
    id: int
    source: str
    source_job_id: str
    company: str  # display_name
    title: str
    location: str | None = None
    apply_url: str
    tier: str | None = None
    fit_score: int | None = None
    status: str
    ingested_at: datetime

    model_config = ConfigDict(from_attributes=True)
