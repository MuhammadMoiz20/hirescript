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
    # Detected cover-letter requirement from the posting's ATS probe.
    # One of: "required" | "optional" | "not_present" | "unknown".
    # Defaults to "unknown" when no probe has run / no key cached on
    # ``posting.meta["cover_letter"]["requirement"]``.
    cover_letter_requirement: Literal[
        "required", "optional", "not_present", "unknown"
    ] = "unknown"
    form_payload: dict | None = None
    submitted_at: datetime | None = None
    error: str | None = None
    verify_ok: bool | None = None
    verify_issues: list[str] = []
    verify_rationale: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ResearchOut(BaseModel):
    """Dream-tier research brief surfaced on the application detail."""

    brief_md: str
    signals_json: dict
    model: str
    generated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApplicationDetailOut(ApplicationOut):
    """Review-queue detail view: adds resume PDF link + prepared timestamp."""

    resume_variant_id: int | None = None
    resume_pdf_url: str | None = None
    canonical_key: str
    prepared_at: datetime
    confirmation_html: str | None = None
    confirmation_screenshot_path: str | None = None
    # Dream-tier research brief (Slice 5 task 12). Present only when the
    # dream_research agent has produced + persisted one for this application.
    research: ResearchOut | None = None


class ApplicationListOut(BaseModel):
    items: list[ApplicationOut]
    total: int
