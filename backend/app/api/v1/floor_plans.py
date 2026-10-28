from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser
from app.schemas.floor_plan import (
    FloorPlanCreate,
    FloorPlanMetaUpdate,
    FloorPlanRead,
    FloorPlanSummary,
    FloorPlanUpdate,
)
from app.services import floor_plan_service
from app.services.errors import ConflictError, NotFoundError

router = APIRouter(prefix="/floor-plans", tags=["floor-plans"])

NOT_FOUND = {status.HTTP_404_NOT_FOUND: {"description": "План не найден"}}


def _unknown_territory(error: NotFoundError) -> HTTPException:
    # Неизвестное здание в теле запроса — ошибка данных (422), а не «план не найден».
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=[{"loc": ["body", "building_id"], "msg": str(error), "type": "value_error"}],
    )

# Смотреть планы может любой вошедший (экран «Карта этажа»), менять — только
# администратор ИС (редактор плана).
_editor = require(Permission.edit_floor_plans)


@router.get("", response_model=list[FloorPlanSummary])
def list_floor_plans(
    building_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_user),
):
    return floor_plan_service.list_floor_plans(db, building_id)


@router.post("", response_model=FloorPlanRead, status_code=status.HTTP_201_CREATED)
def create_floor_plan(data: FloorPlanCreate, db: Session = Depends(get_db), _: AppUser = Depends(_editor)):
    try:
        return floor_plan_service.to_read(floor_plan_service.create_floor_plan(db, data))
    except NotFoundError as error:
        raise _unknown_territory(error) from error
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error


@router.get("/{floor_plan_id}", response_model=FloorPlanRead, responses=NOT_FOUND)
def get_floor_plan(floor_plan_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    floor_plan = floor_plan_service.get_floor_plan(db, floor_plan_id)
    if floor_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor plan not found")
    return floor_plan_service.to_read(floor_plan)


def _get_or_404(db: Session, floor_plan_id: int):
    floor_plan = floor_plan_service.get_floor_plan(db, floor_plan_id)
    if floor_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor plan not found")
    return floor_plan


@router.patch("/{floor_plan_id}", response_model=FloorPlanRead, responses=NOT_FOUND)
def update_floor_plan_meta(
    floor_plan_id: int,
    data: FloorPlanMetaUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(_editor),
):
    floor_plan = _get_or_404(db, floor_plan_id)
    try:
        return floor_plan_service.to_read(floor_plan_service.update_floor_plan_meta(db, floor_plan, data))
    except NotFoundError as error:
        raise _unknown_territory(error) from error
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error


@router.delete("/{floor_plan_id}", status_code=status.HTTP_204_NO_CONTENT, responses=NOT_FOUND)
def delete_floor_plan(floor_plan_id: int, db: Session = Depends(get_db), _: AppUser = Depends(_editor)):
    floor_plan_service.delete_floor_plan(db, _get_or_404(db, floor_plan_id))


@router.put("/{floor_plan_id}", response_model=FloorPlanRead, responses=NOT_FOUND)
def update_floor_plan(
    floor_plan_id: int,
    data: FloorPlanUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(_editor),
):
    floor_plan = floor_plan_service.get_floor_plan(db, floor_plan_id)
    if floor_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor plan not found")
    try:
        return floor_plan_service.to_read(floor_plan_service.replace_floor_plan(db, floor_plan, data))
    except NotFoundError as error:
        raise _unknown_territory(error) from error
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
