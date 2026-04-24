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


class EditRequest(BaseModel):
    instruction: str
    tier: Literal["haiku", "sonnet", "opus"] = "haiku"


class EditAcceptRequest(BaseModel):
    proposed_latex: str
