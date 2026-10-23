from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser, EquipmentStatus
from app.schemas.equipment import AssignmentCreate, EquipmentCard, EquipmentListItem, EquipmentWrite
from app.schemas.page import Page
from app.services import assignment_service, equipment_service
from app.services.equipment_service import EquipmentFilters
from app.services.errors import ConflictError, NotFoundError

router = APIRouter(prefix="/equipment", tags=["equipment"])

_editor = require(Permission.manage_equipment)


@router.get("", response_model=Page[EquipmentListItem])
def list_equipment(
    q: str | None = Query(default=None, max_length=100, description="Инв. номер, серийный, сетевое имя, IP"),
    status_: EquipmentStatus | None = Query(default=None, alias="status"),
    type_id: int | None = None,
    model_id: int | None = None,
    os_id: int | None = None,
    dept_id: int | None = None,
    room_id: int | None = None,
    workplace_id: int | None = None,
    mol_id: int | None = None,
    holder_id: int | None = Query(default=None, description="Выдано сотруднику (последнее назначение)"),
    expiring_within_months: int | None = Query(default=None, ge=0, le=120,
                                               description="Срок службы истекает в ближайшие N месяцев"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    filters = EquipmentFilters(
        q=q, status=status_, type_id=type_id, model_id=model_id, os_id=os_id, dept_id=dept_id,
        room_id=room_id, workplace_id=workplace_id, mol_id=mol_id, holder_id=holder_id,
        expiring_within_months=expiring_within_months,
    )
    items, total = equipment_service.list_equipment(db, user, filters, limit=limit, offset=offset)
    return Page[EquipmentListItem](items=items, total=total)


@router.get("/summary", response_model=dict[str, int], description="Количество единиц по статусам")
def summary(db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    return equipment_service.status_counts(db, user)


@router.get("/{equipment_id}", response_model=EquipmentCard)
def get_card(equipment_id: int, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    try:
        return equipment_service.get_card(db, user, equipment_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.post("", response_model=EquipmentCard, status_code=status.HTTP_201_CREATED)
def register(data: EquipmentWrite, db: Session = Depends(get_db), user: AppUser = Depends(_editor)):
    try:
        return equipment_service.register(db, user, data)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))


@router.put("/{equipment_id}", response_model=EquipmentCard)
def update(equipment_id: int, data: EquipmentWrite, db: Session = Depends(get_db), user: AppUser = Depends(_editor)):
    try:
        equipment_service.get_card(db, user, equipment_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    try:
        return equipment_service.update(db, user, equipment_id, data)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))


@router.post("/{equipment_id}/assignments", response_model=EquipmentCard, status_code=status.HTTP_201_CREATED)
def assign(
    equipment_id: int,
    data: AssignmentCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require(Permission.assign_equipment)),
):
    """Назначение со склада, перемещение или возврат на склад; ответ — обновлённая карточка."""
    try:
        equipment_service.get_card(db, user, equipment_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    try:
        return assignment_service.perform(db, user, equipment_id, data)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
