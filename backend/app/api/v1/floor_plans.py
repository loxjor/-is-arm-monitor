from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser
from app.schemas.floor_plan import (
    FloorPlanCreate,
    FloorPlanRead,
    FloorPlanSummary,
    FloorPlanUpdate,
)
from app.services import floor_plan_service

router = APIRouter(prefix="/floor-plans", tags=["floor-plans"])

NOT_FOUND = {status.HTTP_404_NOT_FOUND: {"description": "План не найден"}}

# Смотреть планы может любой вошедший (экран «Карта этажа»), менять — только
# администратор ИС (редактор плана).
_editor = require(Permission.edit_floor_plans)


@router.get("", response_model=list[FloorPlanSummary])
def list_floor_plans(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return floor_plan_service.list_floor_plans(db)


@router.post("", response_model=FloorPlanRead, status_code=status.HTTP_201_CREATED)
def create_floor_plan(data: FloorPlanCreate, db: Session = Depends(get_db), _: AppUser = Depends(_editor)):
    return floor_plan_service.to_read(floor_plan_service.create_floor_plan(db, data))


@router.get("/{floor_plan_id}", response_model=FloorPlanRead, responses=NOT_FOUND)
def get_floor_plan(floor_plan_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    floor_plan = floor_plan_service.get_floor_plan(db, floor_plan_id)
    if floor_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor plan not found")
    return floor_plan_service.to_read(floor_plan)


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
    return floor_plan_service.to_read(floor_plan_service.replace_floor_plan(db, floor_plan, data))
