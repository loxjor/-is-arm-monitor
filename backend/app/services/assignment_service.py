"""Назначение и перемещение АРМ (А2, BPMN 2.6).

Запись истории, статус и размещение меняются в одной транзакции — история
не может разойтись с реестром.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AppUser,
    Assignment,
    AssignmentOperation,
    Employee,
    Equipment,
    EquipmentStatus,
    Workplace,
)
from app.schemas.equipment import AssignmentCreate, EquipmentCard
from app.services import audit_service, equipment_service
from app.services.errors import ConflictError, NotFoundError

# Из какого статуса допустима операция и в какой статус она переводит.
_TRANSITIONS: dict[AssignmentOperation, tuple[EquipmentStatus, EquipmentStatus]] = {
    AssignmentOperation.assign: (EquipmentStatus.in_stock, EquipmentStatus.in_use),
    AssignmentOperation.move: (EquipmentStatus.in_use, EquipmentStatus.in_use),
    AssignmentOperation.return_: (EquipmentStatus.in_use, EquipmentStatus.in_stock),
}

_STATUS_TITLES = {
    EquipmentStatus.in_stock: "«На складе»",
    EquipmentStatus.in_use: "«В эксплуатации»",
    EquipmentStatus.in_repair: "«В ремонте»",
    EquipmentStatus.pending_writeoff: "«К списанию»",
    EquipmentStatus.written_off: "«Списано»",
}


def _next_timestamp(db: Session, equipment_id: int) -> datetime:
    # assigned_at входит в первичный ключ: две операции подряд в одну и ту же
    # микросекунду (или при отставших часах) не должны конфликтовать.
    now = datetime.now()
    last = db.scalar(select(func.max(Assignment.assigned_at)).where(Assignment.equipment_id == equipment_id))
    return max(now, last + timedelta(microseconds=1)) if last else now


def _current_holder_id(db: Session, equipment_id: int) -> int | None:
    current = db.scalar(
        equipment_service.current_assignments().where(Assignment.equipment_id == equipment_id)
    )
    if current is None or current.operation is AssignmentOperation.return_:
        return None
    return current.employee_id


def perform(db: Session, user: AppUser, equipment_id: int, data: AssignmentCreate) -> EquipmentCard:
    equipment: Equipment = equipment_service.get_visible(db, user, equipment_id)
    required_status, new_status = _TRANSITIONS[data.operation]
    if equipment.status is not required_status:
        raise ConflictError(
            f"Операция недоступна: оборудование в статусе {_STATUS_TITLES[equipment.status]}, "
            f"нужен {_STATUS_TITLES[required_status]}"
        )

    if data.workplace_id is not None and db.get(Workplace, data.workplace_id) is None:
        raise NotFoundError("Рабочее место не найдено")
    if data.employee_id is not None and db.get(Employee, data.employee_id) is None:
        raise NotFoundError("Сотрудник не найден")

    holder_id = _current_holder_id(db, equipment_id)
    if data.operation is AssignmentOperation.return_:
        workplace_id, employee_id = None, None
    elif data.operation is AssignmentOperation.move:
        workplace_id = data.workplace_id if data.workplace_id is not None else equipment.workplace_id
        employee_id = data.employee_id if data.employee_id is not None else holder_id
        if workplace_id == equipment.workplace_id and employee_id == holder_id:
            raise ConflictError("Новое размещение совпадает с текущим")
    else:
        workplace_id, employee_id = data.workplace_id, data.employee_id

    db.add(
        Assignment(
            equipment_id=equipment_id,
            assigned_at=_next_timestamp(db, equipment_id),
            operation=data.operation,
            basis=data.basis,
            employee_id=employee_id,
            workplace_id=workplace_id,
            user_id=user.user_id,
        )
    )
    audit_service.record(
        db,
        user_id=user.user_id,
        action=data.operation.value,
        entity="equipment",
        entity_id=equipment_id,
        details={
            "workplace_id": {"from": equipment.workplace_id, "to": workplace_id},
            "employee_id": {"from": holder_id, "to": employee_id},
            "status": {"from": equipment.status.value, "to": new_status.value},
            "basis": data.basis,
        },
    )
    equipment.workplace_id = workplace_id
    equipment.status = new_status
    db.commit()
    db.expire_all()
    return equipment_service.get_card(db, user, equipment_id)
