from pydantic import BaseModel
from datetime import datetime

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
