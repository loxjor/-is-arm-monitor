from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    log_id: int
    occurred_at: datetime
    user_id: int | None
    action: str
    entity: str | None
    entity_id: str | None
    details: str | None


class AuditLogPage(BaseModel):
    items: list[AuditLogRead]
    total: int
