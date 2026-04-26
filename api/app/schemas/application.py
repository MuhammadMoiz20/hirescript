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

    model_config = ConfigDict(from_attributes=True)
