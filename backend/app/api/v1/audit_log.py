from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser
from app.schemas.audit_log import AuditLogPage
from app.services import audit_service

router = APIRouter(prefix="/audit-log", tags=["audit-log"])


@router.get("", response_model=AuditLogPage)
def list_audit_log(
    user_id: int | None = None,
    entity: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require(Permission.view_audit_log)),
):
    items, total = audit_service.list_entries(
        db,
        user_id=user_id,
        entity=entity,
        action=action,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return AuditLogPage(items=items, total=total)
