"""Журнал действий пользователей — сверх Т-модели курсового (BPMN «Администрирование»)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    log_id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    # NULL — неудачный вход: пользователь не опознан, но попытку надо записать.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"), index=True)
    action: Mapped[str] = mapped_column(String(50))
    entity: Mapped[str | None] = mapped_column(String(50))
    # Строка, а не FK: у части сущностей составной ключ (assignment, ticket_work).
    entity_id: Mapped[str | None] = mapped_column(String(50))
    details: Mapped[str | None] = mapped_column(Text)
