import uuid
from pydantic import BaseModel, Field
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


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class EditRequest(BaseModel):
    instruction: str
    tier: Literal["haiku", "sonnet", "opus"] = "haiku"
    # Latex currently visible in the editor. When provided, the backend uses
    # this in preference to the DB-stored latex_source so that unsaved edits
    # are reflected. Falls back to the DB value when None.
    current_latex: str | None = None
    # Prior turns of this chat session, oldest first. Used to give the model
    # multi-turn context. Kept short by the client.
    history: list[ChatTurn] = []


class EditAcceptRequest(BaseModel):
    proposed_latex: str


class TailorRequest(BaseModel):
    title: str
    company: str
    url: str | None = None
    jd_text: str
    deep_tailor: bool = False


class SectionsResponse(BaseModel):
    template_id: str
    schema_: dict = Field(alias="schema")
    content_json: dict
    model_config = {"populate_by_name": True}


class SectionsPutRequest(BaseModel):
    content_json: dict


class OnboardTexRequest(BaseModel):
    name: str
    latex_source: str


class OnboardedResumeOut(ResumeOut):
    enforced: bool
    iterations: int
    page_count: int


class VersionSummary(BaseModel):
    id: int
    edit_source: str
    edit_prompt: str | None
    page_count: int
    created_at: datetime
    model_config = {"from_attributes": True}


class VersionDetail(VersionSummary):
    resume_id: int
    latex_source: str
    content_json: dict


class JobDescriptionOut(BaseModel):
    id: int
    title: str
    company: str
    url: str | None = None
    raw_text: str
    created_at: datetime
    model_config = {"from_attributes": True}


class TailorResponse(BaseModel):
    variant: ResumeOut
    jd_id: int
    page_count: int
    iterations: int
    enforced: bool
    tier_history: list[str]
    keywords_used: list[str]


class TailorItem(BaseModel):
    jd_text: str
    title: str
    company: str
    url: str | None = None


class EnqueueTailorIn(BaseModel):
    resume_id: int
    items: list[TailorItem]
    deep: bool = False


class EnqueueTailorOut(BaseModel):
    batch_id: uuid.UUID
    job_ids: list[uuid.UUID]
