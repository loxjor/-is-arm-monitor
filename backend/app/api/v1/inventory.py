from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser
from app.schemas.inventory import (
    InventoryCreate,
    InventoryDetail,
    InventoryItem,
    InventoryItemMark,
    InventoryRead,
    InventoryRoom,
    InventoryScan,
    InventoryTerritory,
)
from app.schemas.page import Page
from app.services import inventory_service
from app.services.errors import NotFoundError

router = APIRouter(prefix="/inventory", tags=["inventory"])

_actor = require(Permission.conduct_inventory)


@router.get("/territories", response_model=list[InventoryTerritory])
def territories(db: Session = Depends(get_db), user: AppUser = Depends(_actor)):
    return inventory_service.inventory_territories(db, user)


@router.get("/territories/{building_id}/rooms", response_model=list[InventoryRoom])
def rooms(building_id: int, db: Session = Depends(get_db), user: AppUser = Depends(_actor)):
    try:
        return inventory_service.inventory_rooms(db, user, building_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.get("", response_model=Page[InventoryRead])
def list_inventories(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AppUser = Depends(_actor),
):
    items, total = inventory_service.list_inventories(db, user, limit=limit, offset=offset)
    return Page[InventoryRead](items=items, total=total)


@router.post("", response_model=InventoryDetail, status_code=status.HTTP_201_CREATED)
def start_inventory(data: InventoryCreate, db: Session = Depends(get_db), user: AppUser = Depends(_actor)):
    try:
        return inventory_service.start_inventory(db, user, data)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.get("/{inventory_id}", response_model=InventoryDetail)
def get_inventory(inventory_id: int, db: Session = Depends(get_db), user: AppUser = Depends(_actor)):
    try:
        return inventory_service.get_inventory(db, user, inventory_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.post("/{inventory_id}/items/{equipment_id}", response_model=InventoryItem)
def mark_item(
    inventory_id: int,
    equipment_id: int,
    data: InventoryItemMark,
    db: Session = Depends(get_db),
    user: AppUser = Depends(_actor),
):
    try:
        return inventory_service.mark_item(db, user, inventory_id, equipment_id, data)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.post("/{inventory_id}/scan", response_model=InventoryItem)
def scan_item(
    inventory_id: int,
    data: InventoryScan,
    db: Session = Depends(get_db),
    user: AppUser = Depends(_actor),
):
    try:
        return inventory_service.scan_item(db, user, inventory_id, data.code)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.post("/{inventory_id}/finish", response_model=InventoryRead)
def finish_inventory(inventory_id: int, db: Session = Depends(get_db), user: AppUser = Depends(_actor)):
    try:
        return inventory_service.finish_inventory(db, user, inventory_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
