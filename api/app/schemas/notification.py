from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    id: int
    user_id: int
    kind: str
    title: str
    body: str
    meta: dict = {}
    delivered_at: datetime | None = None
    read_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
