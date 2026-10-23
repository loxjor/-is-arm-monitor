from __future__ import annotations

import json
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditLog


def record(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    entity: str | None = None,
    entity_id: object | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Добавляет запись в сессию без commit — она фиксируется вместе с самим действием."""
    db.add(
        AuditLog(
            occurred_at=datetime.now(),
            user_id=user_id,
            action=action,
            entity=entity,
            entity_id=None if entity_id is None else str(entity_id),
            details=None if details is None else json.dumps(details, ensure_ascii=False, default=str),
        )
    )


def list_entries(
    db: Session,
    *,
    user_id: int | None = None,
    entity: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    query = select(AuditLog)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    if entity is not None:
        query = query.where(AuditLog.entity == entity)
    if action is not None:
        query = query.where(AuditLog.action == action)
    if date_from is not None:
        query = query.where(AuditLog.occurred_at >= datetime.combine(date_from, time.min))
    if date_to is not None:
        query = query.where(AuditLog.occurred_at <= datetime.combine(date_to, time.max))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(AuditLog.occurred_at.desc(), AuditLog.log_id.desc()).limit(limit).offset(offset)
    )
    return list(items), total
