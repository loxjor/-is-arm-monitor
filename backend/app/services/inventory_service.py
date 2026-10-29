"""Инвентаризация (BPMN 2.7): территории, помещения, записи и отметки единиц."""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import Select, and_, case, func, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    AppUser,
    Building,
    Equipment,
    EquipmentModel,
    EquipmentStatus,
    Inventory,
    InventoryResult,
    InventoryStatus,
    Room,
    Workplace,
)
from app.schemas.inventory import (
    InventoryCreate,
    InventoryDetail,
    InventoryItem,
    InventoryItemMark,
    InventoryRead,
    InventoryRoom,
    InventoryTerritory,
)
from app.services import audit_service
from app.services.errors import NotFoundError

# Ссылка на карточку, которую кодирует QR-этикетка: https://…/admin.html#/equipment/123
_CARD_URL = re.compile(r"#/equipment/(\d+)")


def _placed(building_id: int, room_id: int | None = None) -> Select[tuple[Equipment]]:
    """Единицы, стоящие в помещениях территории (и кабинета) и не списанные."""
    query = (
        select(Equipment)
        .join(Workplace, Equipment.workplace_id == Workplace.workplace_id)
        .join(Room, Workplace.room_id == Room.room_id)
        .where(Equipment.status != EquipmentStatus.written_off, Room.building_id == building_id)
    )
    if room_id is not None:
        query = query.where(Room.room_id == room_id)
    return query


def _equipment_options() -> list:
    return [
        joinedload(Equipment.model).joinedload(EquipmentModel.equipment_type),
        joinedload(Equipment.model).joinedload(EquipmentModel.manufacturer),
        joinedload(Equipment.workplace).joinedload(Workplace.room),
        joinedload(Equipment.mol),
    ]


def inventory_territories(db: Session, _user: AppUser) -> list[InventoryTerritory]:
    """Подконтрольные территории: здания с количеством подлежащей проверке техники."""
    counts = dict(
        db.execute(
            select(Room.building_id, func.count())
            .join(Workplace, Workplace.room_id == Room.room_id)
            .join(Equipment, Equipment.workplace_id == Workplace.workplace_id)
            .where(Equipment.status != EquipmentStatus.written_off)
            .group_by(Room.building_id)
        ).all()
    )
    return [
        InventoryTerritory(
            building_id=building.building_id,
            name=building.name,
            address=building.address,
            equipment_count=counts.get(building.building_id, 0),
        )
        for building in db.scalars(select(Building).order_by(Building.name))
    ]


def inventory_rooms(db: Session, _user: AppUser, building_id: int) -> list[InventoryRoom]:
    if db.get(Building, building_id) is None:
        raise NotFoundError("Территория не найдена")
    counts = dict(
        db.execute(
            select(Workplace.room_id, func.count())
            .join(Equipment, Equipment.workplace_id == Workplace.workplace_id)
            .where(Equipment.status != EquipmentStatus.written_off)
            .group_by(Workplace.room_id)
        ).all()
    )
    rooms = db.scalars(select(Room).where(Room.building_id == building_id).order_by(Room.floor, Room.room_no))
    return [
        InventoryRoom(
            room_id=room.room_id,
            room_no=room.room_no,
            floor=room.floor,
            equipment_count=counts.get(room.room_id, 0),
        )
        for room in rooms
    ]


def _responsible_name(inventory: Inventory) -> str | None:
    return inventory.responsible.employee.full_name if inventory.responsible and inventory.responsible.employee else None


def _counts(db: Session, inventory_ids: list[int]) -> dict[int, tuple[int, int, int]]:
    """inventory_id → (всего, проверено, в наличии)."""
    if not inventory_ids:
        return {}
    rows = db.execute(
        select(
            InventoryResult.inventory_id,
            func.count(),
            func.coalesce(func.sum(case((InventoryResult.checked.is_(True), 1), else_=0)), 0),
            func.coalesce(
                func.sum(case((and_(InventoryResult.checked.is_(True), InventoryResult.is_present.is_(True)), 1), else_=0)),
                0,
            ),
        )
        .where(InventoryResult.inventory_id.in_(inventory_ids))
        .group_by(InventoryResult.inventory_id)
    ).all()
    return {inv_id: (total, checked, present) for inv_id, total, checked, present in rows}


def _to_read(inventory: Inventory, counts: tuple[int, int, int]) -> InventoryRead:
    total, checked, present = counts
    return InventoryRead(
        inventory_id=inventory.inventory_id,
        started_on=inventory.started_on,
        finished_on=inventory.finished_on,
        basis=inventory.basis,
        status=inventory.status,
        building_id=inventory.building_id,
        building_name=inventory.building.name if inventory.building else None,
        room_id=inventory.room_id,
        room_no=inventory.room.room_no if inventory.room else None,
        responsible_name=_responsible_name(inventory),
        total_count=total,
        checked_count=checked,
        present_count=present,
    )


def _inventory_query() -> Select[tuple[Inventory]]:
    return select(Inventory).options(
        joinedload(Inventory.building),
        joinedload(Inventory.room),
        joinedload(Inventory.responsible).joinedload(AppUser.employee),
    )


def list_inventories(db: Session, _user: AppUser, *, limit: int, offset: int) -> tuple[list[InventoryRead], int]:
    query = _inventory_query().order_by(Inventory.started_on.desc(), Inventory.inventory_id.desc())
    total = db.scalar(select(func.count()).select_from(Inventory)) or 0
    inventories = list(db.scalars(query.limit(limit).offset(offset)).unique())
    counts = _counts(db, [inv.inventory_id for inv in inventories])
    return [_to_read(inv, counts.get(inv.inventory_id, (0, 0, 0))) for inv in inventories], total


def _get_inventory(db: Session, inventory_id: int) -> Inventory:
    inventory = db.scalars(
        _inventory_query().where(Inventory.inventory_id == inventory_id)
    ).unique().one_or_none()
    if inventory is None:
        raise NotFoundError("Инвентаризация не найдена")
    return inventory


def _item(equipment: Equipment, result: InventoryResult) -> InventoryItem:
    workplace = equipment.workplace
    room = workplace.room if workplace else None
    return InventoryItem(
        equipment_id=equipment.equipment_id,
        inventory_no=equipment.inventory_no,
        serial_no=equipment.serial_no,
        model_name=equipment.model.name,
        type_name=equipment.model.equipment_type.name,
        manufacturer_name=equipment.model.manufacturer.name,
        room_no=room.room_no if room else None,
        workplace_no=workplace.workplace_no if workplace else None,
        mol_name=equipment.mol.full_name if equipment.mol else None,
        checked=result.checked,
        is_present=result.is_present,
        discrepancy=result.discrepancy,
        note=result.note,
    )


def get_inventory(db: Session, _user: AppUser, inventory_id: int) -> InventoryDetail:
    inventory = _get_inventory(db, inventory_id)
    result_rows = list(db.scalars(select(InventoryResult).where(InventoryResult.inventory_id == inventory_id)))
    results = {result.equipment_id: result for result in result_rows}
    equipment = list(
        db.scalars(_placed(inventory.building_id, inventory.room_id).options(*_equipment_options()).order_by(Equipment.inventory_no))
    )
    # Техника, которую перенесли уже после старта, остаётся в результатах — не теряем её.
    existing = {e.equipment_id for e in equipment}
    for result in result_rows:
        if result.equipment_id not in existing:
            extra = db.get(Equipment, result.equipment_id)
            if extra is not None:
                equipment.append(extra)
                existing.add(extra.equipment_id)
    equipment.sort(key=lambda e: e.inventory_no)
    items = [
        _item(e, results.get(e.equipment_id) or InventoryResult(checked=False, is_present=False))
        for e in equipment
    ]
    counts = _counts(db, [inventory_id]).get(inventory_id, (len(items), 0, 0))
    base = _to_read(inventory, counts)
    return InventoryDetail(**base.model_dump(), items=items)


def start_inventory(db: Session, user: AppUser, data: InventoryCreate) -> InventoryDetail:
    building = db.get(Building, data.building_id)
    if building is None:
        raise NotFoundError("Территория не найдена")
    room = None
    if data.room_id is not None:
        room = db.get(Room, data.room_id)
        if room is None or room.building_id != data.building_id:
            raise NotFoundError("Помещение не найдено в выбранной территории")

    equipment = db.scalars(_placed(data.building_id, data.room_id).options(*_equipment_options())).all()
    inventory = Inventory(
        started_on=date.today(),
        basis=data.basis.strip(),
        status=InventoryStatus.open,
        building_id=data.building_id,
        room_id=data.room_id,
        responsible_user_id=user.user_id,
    )
    db.add(inventory)
    db.flush()
    for item in equipment:
        db.add(
            InventoryResult(
                inventory_id=inventory.inventory_id,
                equipment_id=item.equipment_id,
                is_present=False,
                checked=False,
                actual_room_id=item.workplace.room_id if item.workplace else None,
            )
        )
    audit_service.record(
        db, user_id=user.user_id, action="create", entity="inventory", entity_id=inventory.inventory_id,
        details={"basis": inventory.basis, "building_id": data.building_id, "room_id": data.room_id},
    )
    db.commit()
    return get_inventory(db, user, inventory.inventory_id)


def _get_result(db: Session, inventory_id: int, equipment_id: int) -> InventoryResult:
    result = db.get(InventoryResult, (inventory_id, equipment_id))
    if result is None:
        raise NotFoundError("Единица не участвует в этой инвентаризации")
    return result


def mark_item(db: Session, user: AppUser, inventory_id: int, equipment_id: int, data: InventoryItemMark) -> InventoryItem:
    inventory = _get_inventory(db, inventory_id)
    if inventory.status is InventoryStatus.closed:
        raise NotFoundError("Инвентаризация завершена")
    result = _get_result(db, inventory_id, equipment_id)
    result.checked = data.checked
    result.is_present = data.is_present
    result.discrepancy = data.discrepancy if (data.checked and not data.is_present) else None
    result.note = data.note
    audit_service.record(
        db, user_id=user.user_id, action="update", entity="inventory_result",
        entity_id=f"{inventory_id}/{equipment_id}",
        details={"checked": data.checked, "is_present": data.is_present},
    )
    db.commit()
    equipment = db.get(Equipment, equipment_id)
    return _item(equipment, result)


def scan_item(db: Session, user: AppUser, inventory_id: int, code: str) -> InventoryItem:
    inventory = _get_inventory(db, inventory_id)
    if inventory.status is InventoryStatus.closed:
        raise NotFoundError("Инвентаризация завершена")

    value = code.strip()
    equipment = _find_by_code(db, inventory_id, value)
    if equipment is None:
        raise NotFoundError(f"По коду «{value}» техника не найдена в этой инвентаризации")

    result = _get_result(db, inventory_id, equipment.equipment_id)
    result.checked = True
    result.is_present = True
    result.discrepancy = None
    audit_service.record(
        db, user_id=user.user_id, action="update", entity="inventory_result",
        entity_id=f"{inventory_id}/{equipment.equipment_id}", details={"scanned": True},
    )
    db.commit()
    return _item(equipment, result)


def _find_by_code(db: Session, inventory_id: int, code: str) -> Equipment | None:
    """Код сканера: ссылка на карточку, инвентарный/серийный номер или id единицы."""
    match = _CARD_URL.search(code)
    if match:
        equipment_id = int(match.group(1))
        if _participates(db, inventory_id, equipment_id):
            return db.get(Equipment, equipment_id)
        return None
    if code.isdigit():
        equipment_id = int(code)
        if _participates(db, inventory_id, equipment_id):
            return db.get(Equipment, equipment_id)
    equipment = db.scalars(
        select(Equipment).where(
            Equipment.equipment_id.in_(
                select(InventoryResult.equipment_id).where(InventoryResult.inventory_id == inventory_id)
            ),
            (Equipment.inventory_no == code) | (Equipment.serial_no == code),
        )
    ).first()
    return equipment


def _participates(db: Session, inventory_id: int, equipment_id: int) -> bool:
    return (
        db.scalar(
            select(InventoryResult.equipment_id).where(
                InventoryResult.inventory_id == inventory_id, InventoryResult.equipment_id == equipment_id
            )
        )
        is not None
    )


def finish_inventory(db: Session, user: AppUser, inventory_id: int) -> InventoryRead:
    inventory = _get_inventory(db, inventory_id)
    if inventory.status is InventoryStatus.closed:
        raise NotFoundError("Инвентаризация уже завершена")
    inventory.status = InventoryStatus.closed
    inventory.finished_on = date.today()
    audit_service.record(
        db, user_id=user.user_id, action="status_change", entity="inventory",
        entity_id=inventory_id, details={"status": InventoryStatus.closed.value},
    )
    db.commit()
    counts = _counts(db, [inventory_id]).get(inventory_id, (0, 0, 0))
    return _to_read(inventory, counts)
