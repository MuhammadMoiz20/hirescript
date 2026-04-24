from pydantic import BaseModel
from datetime import datetime
from typing import Literal

class ResumeCreate(BaseModel):
    name: str
    template_id: str

class ResumeUpdate(BaseModel):
    name: str | None = None
    latex_source: str | None = None

class ResumeOut(BaseModel):
    id: int
    name: str
    template_id: str
    kind: str
    latex_source: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class VariantOut(ResumeOut):
    parent_id: int
    job_description_id: int | None = None
    jd_title: str | None = None
    jd_company: str | None = None


class ResumeGroup(BaseModel):
    master: ResumeOut
    variants: list[VariantOut]


class EditRequest(BaseModel):
    instruction: str
    tier: Literal["haiku", "sonnet", "opus"] = "haiku"


class EditAcceptRequest(BaseModel):
    proposed_latex: str


class TailorRequest(BaseModel):
    title: str
    company: str
    url: str | None = None
    jd_text: str
    deep_tailor: bool = False


class TailorResponse(BaseModel):
    variant: ResumeOut
    jd_id: int
    page_count: int
    iterations: int
    enforced: bool
    tier_history: list[str]
    keywords_used: list[str]
