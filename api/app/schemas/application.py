from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.posting import JobPostingOut


class ApplicationOut(BaseModel):
    id: int
    posting_id: int
    posting: JobPostingOut
    status: str
    mode: Literal["A", "B"]
    cover_letter_text: str | None = None
    form_payload: dict | None = None
    submitted_at: datetime | None = None
    error: str | None = None
    verify_ok: bool | None = None
    verify_issues: list[str] = []
    verify_rationale: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ApplicationDetailOut(ApplicationOut):
    """Review-queue detail view: adds resume PDF link + prepared timestamp."""

    resume_variant_id: int | None = None
    resume_pdf_url: str | None = None
    canonical_key: str
    prepared_at: datetime
    confirmation_html: str | None = None
    confirmation_screenshot_path: str | None = None


class ApplicationListOut(BaseModel):
    items: list[ApplicationOut]
    total: int
