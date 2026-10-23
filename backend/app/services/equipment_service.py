"""Реестр оборудования (А1): постановка на учёт, карточка, поиск с фильтрами.

Статус и размещение здесь не меняются — это делают assignment_service и
сервисы заявок, инвентаризации и списания (этапы 6–8).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from app.core.permissions import ROLE_SCOPE, DataScope, RoleCode
from app.models import (
    AppUser,
    Assignment,
    AssignmentOperation,
    Employee,
    Equipment,
    EquipmentModel,
    EquipmentStatus,
    OperatingSystem,
    Room,
    Workplace,
)
from app.schemas.equipment import AssignmentRead, EquipmentCard, EquipmentListItem, EquipmentWrite
from app.services import audit_service
from app.services.errors import ConflictError, NotFoundError


@dataclass(frozen=True)
class EquipmentFilters:
    q: str | None = None
    status: EquipmentStatus | None = None
    type_id: int | None = None
    model_id: int | None = None
    os_id: int | None = None
    dept_id: int | None = None
    room_id: int | None = None
    workplace_id: int | None = None
    mol_id: int | None = None
    expiring_within_months: int | None = None


def current_assignments() -> Select[tuple[Assignment]]:
    """Последняя запись истории по каждой единице — по ней определяется, кому выдано."""
    latest = (
        select(Assignment.equipment_id, func.max(Assignment.assigned_at).label("assigned_at"))
        .group_by(Assignment.equipment_id)
        .subquery()
    )
    return select(Assignment).join(
        latest,
        and_(Assignment.equipment_id == latest.c.equipment_id, Assignment.assigned_at == latest.c.assigned_at),
    )


def _holders(db: Session, equipment_ids: list[int]) -> dict[int, Employee]:
    if not equipment_ids:
        return {}
    rows = db.scalars(
        current_assignments()
        .options(joinedload(Assignment.employee))
        .where(
            Assignment.equipment_id.in_(equipment_ids),
            Assignment.operation != AssignmentOperation.return_,
            Assignment.employee_id.is_not(None),
        )
    )
    return {a.equipment_id: a.employee for a in rows if a.employee is not None}


def add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year, month = value.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def service_end(equipment: Equipment) -> date | None:
    if equipment.commissioned_on is None:
        return None
    return add_months(equipment.commissioned_on, equipment.model.equipment_type.service_life_months)


def _loaded() -> Select[tuple[Equipment]]:
    return select(Equipment).options(
        joinedload(Equipment.model).joinedload(EquipmentModel.equipment_type),
        joinedload(Equipment.model).joinedload(EquipmentModel.manufacturer),
        joinedload(Equipment.operating_system),
        joinedload(Equipment.workplace).joinedload(Workplace.room).joinedload(Room.department),
        joinedload(Equipment.mol),
    )


def _apply_scope(query: Select[tuple[Equipment]], user: AppUser) -> Select[tuple[Equipment]]:
    """Сотрудник видит закреплённое за ним, руководитель — своё подразделение (табл. 1.2).

    «Закреплённое» — где сотрудник МОЛ или кому оборудование выдано последним назначением.
    """
    scope = ROLE_SCOPE[RoleCode(user.role.code)]
    if scope is DataScope.all:
        return query
    if scope is DataScope.own:
        issued = (
            current_assignments()
            .where(Assignment.employee_id == user.employee_id, Assignment.operation != AssignmentOperation.return_)
            .with_only_columns(Assignment.equipment_id)
        )
        return query.where(or_(Equipment.mol_id == user.employee_id, Equipment.equipment_id.in_(issued)))
    return _where_department(query, user.employee.dept_id)


def _where_department(query: Select[tuple[Equipment]], dept_id: int) -> Select[tuple[Equipment]]:
    # Оборудование относится к подразделению, если стоит в его помещении
    # или числится за его сотрудником-МОЛ.
    mol = aliased(Employee)
    placed = select(Workplace.workplace_id).join(Room).where(Room.dept_id == dept_id)
    return query.outerjoin(mol, Equipment.mol_id == mol.employee_id).where(
        or_(Equipment.workplace_id.in_(placed), mol.dept_id == dept_id)
    )


def _filtered(query: Select[tuple[Equipment]], filters: EquipmentFilters) -> Select[tuple[Equipment]]:
    if filters.q:
        pattern = f"%{filters.q.strip()}%"
        query = query.where(
            or_(
                Equipment.inventory_no.ilike(pattern),
                Equipment.serial_no.ilike(pattern),
                Equipment.hostname.ilike(pattern),
                Equipment.ip_address.ilike(pattern),
            )
        )
    if filters.status is not None:
        query = query.where(Equipment.status == filters.status)
    if filters.model_id is not None:
        query = query.where(Equipment.model_id == filters.model_id)
    if filters.type_id is not None:
        query = query.where(
            Equipment.model_id.in_(select(EquipmentModel.model_id).where(EquipmentModel.type_id == filters.type_id))
        )
    if filters.os_id is not None:
        query = query.where(Equipment.os_id == filters.os_id)
    if filters.mol_id is not None:
        query = query.where(Equipment.mol_id == filters.mol_id)
    if filters.room_id is not None:
        query = query.where(
            Equipment.workplace_id.in_(select(Workplace.workplace_id).where(Workplace.room_id == filters.room_id))
        )
    if filters.workplace_id is not None:
        query = query.where(Equipment.workplace_id == filters.workplace_id)
    if filters.dept_id is not None:
        query = _where_department(query, filters.dept_id)
    return query


def _to_item(equipment: Equipment, holder: Employee | None) -> EquipmentListItem:
    model = equipment.model
    workplace = equipment.workplace
    return EquipmentListItem(
        equipment_id=equipment.equipment_id,
        inventory_no=equipment.inventory_no,
        serial_no=equipment.serial_no,
        hostname=equipment.hostname,
        status=equipment.status,
        model_id=model.model_id,
        model_name=model.name,
        type_id=model.type_id,
        type_name=model.equipment_type.name,
        manufacturer_name=model.manufacturer.name,
        os_id=equipment.os_id,
        os_name=equipment.operating_system.name if equipment.operating_system else None,
        workplace_id=equipment.workplace_id,
        workplace_no=workplace.workplace_no if workplace else None,
        room_id=workplace.room_id if workplace else None,
        room_no=workplace.room.room_no if workplace else None,
        mol_id=equipment.mol_id,
        mol_name=equipment.mol.full_name if equipment.mol else None,
        holder_id=holder.employee_id if holder else None,
        holder_name=holder.full_name if holder else None,
        commissioned_on=equipment.commissioned_on,
        service_end=service_end(equipment),
        book_value=float(equipment.book_value) if equipment.book_value is not None else None,
    )


def list_equipment(
    db: Session, user: AppUser, filters: EquipmentFilters, *, limit: int, offset: int
) -> tuple[list[EquipmentListItem], int]:
    query = _filtered(_apply_scope(_loaded(), user), filters).order_by(Equipment.inventory_no)

    if filters.expiring_within_months is None:
        total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
        page = list(db.scalars(query.limit(limit).offset(offset)).unique())
    else:
        # Срок службы = дата ввода + срок типа: арифметика дат в SQL у PostgreSQL и
        # SQLite разная, а парк — сотни единиц, поэтому фильтр считается в Python.
        cutoff = add_months(date.today(), filters.expiring_within_months)
        expiring = [
            e for e in db.scalars(query).unique()
            if (end := service_end(e)) is not None and end <= cutoff and e.status is not EquipmentStatus.written_off
        ]
        total, page = len(expiring), expiring[offset : offset + limit]

    holders = _holders(db, [e.equipment_id for e in page])
    return [_to_item(e, holders.get(e.equipment_id)) for e in page], total


def get_visible(db: Session, user: AppUser, equipment_id: int) -> Equipment:
    query = _apply_scope(_loaded(), user).where(Equipment.equipment_id == equipment_id)
    equipment = db.scalars(query).unique().one_or_none()
    # Чужое оборудование — 404, а не 403: не подтверждаем, что такой номер есть.
    if equipment is None:
        raise NotFoundError("Оборудование не найдено")
    return equipment


def get_card(db: Session, user: AppUser, equipment_id: int) -> EquipmentCard:
    equipment = get_visible(db, user, equipment_id)
    assignments = list(
        db.scalars(
            select(Assignment)
            .options(selectinload(Assignment.employee), selectinload(Assignment.workplace))
            .where(Assignment.equipment_id == equipment_id)
            .order_by(Assignment.assigned_at.desc())
        )
    )
    user_ids = {a.user_id for a in assignments}
    logins = {
        user_id: login
        for user_id, login in db.execute(
            select(AppUser.user_id, AppUser.login).where(AppUser.user_id.in_(user_ids))
        ).tuples()
    }
    workplace = equipment.workplace
    return EquipmentCard(
        **_to_item(equipment, _holders(db, [equipment_id]).get(equipment_id)).model_dump(),
        cpu=equipment.cpu,
        ram_gb=equipment.ram_gb,
        storage_gb=equipment.storage_gb,
        ip_address=equipment.ip_address,
        dept_name=workplace.room.department.name if workplace and workplace.room.department else None,
        assignments=[
            AssignmentRead(
                assigned_at=a.assigned_at,
                operation=a.operation,
                basis=a.basis,
                employee_name=a.employee.full_name if a.employee else None,
                workplace_no=a.workplace.workplace_no if a.workplace else None,
                user_login=logins.get(a.user_id, "?"),
            )
            for a in assignments
        ],
    )


def _check_references(db: Session, data: EquipmentWrite) -> None:
    if db.get(EquipmentModel, data.model_id) is None:
        raise NotFoundError("Модель оборудования не найдена")
    if data.os_id is not None and db.get(OperatingSystem, data.os_id) is None:
        raise NotFoundError("Операционная система не найдена")
    if data.mol_id is not None:
        mol = db.get(Employee, data.mol_id)
        if mol is None:
            raise NotFoundError("Сотрудник (МОЛ) не найден")
        if not mol.is_mol:
            raise ConflictError("Сотрудник не является материально ответственным лицом")


def _check_inventory_no_unique(db: Session, inventory_no: str, exclude_id: int | None = None) -> None:
    query = select(Equipment.equipment_id).where(Equipment.inventory_no == inventory_no)
    if exclude_id is not None:
        query = query.where(Equipment.equipment_id != exclude_id)
    if db.scalar(query) is not None:
        raise ConflictError(f"Инвентарный номер {inventory_no} уже есть в реестре")


def register(db: Session, user: AppUser, data: EquipmentWrite) -> EquipmentCard:
    """Постановка на учёт (BPMN 2.5): статус всегда «На складе»."""
    _check_references(db, data)
    _check_inventory_no_unique(db, data.inventory_no)
    equipment = Equipment(**data.model_dump(), status=EquipmentStatus.in_stock)
    db.add(equipment)
    db.flush()
    audit_service.record(
        db, user_id=user.user_id, action="create", entity="equipment", entity_id=equipment.equipment_id,
        details=data.model_dump(),
    )
    db.commit()
    return get_card(db, user, equipment.equipment_id)


def update(db: Session, user: AppUser, equipment_id: int, data: EquipmentWrite) -> EquipmentCard:
    equipment = get_visible(db, user, equipment_id)
    if equipment.status is EquipmentStatus.written_off:
        raise ConflictError("Списанное оборудование не редактируется")
    _check_references(db, data)
    _check_inventory_no_unique(db, data.inventory_no, exclude_id=equipment_id)

    values = data.model_dump()
    changes = {
        name: {"from": getattr(equipment, name), "to": value}
        for name, value in values.items()
        if getattr(equipment, name) != value
    }
    for name, value in values.items():
        setattr(equipment, name, value)
    if changes:
        audit_service.record(
            db, user_id=user.user_id, action="update", entity="equipment", entity_id=equipment_id, details=changes
        )
    db.commit()
    db.expire_all()
    return get_card(db, user, equipment_id)


def status_counts(db: Session, user: AppUser) -> dict[str, int]:
    query = _apply_scope(select(Equipment), user).subquery()
    rows = db.execute(select(query.c.status, func.count()).group_by(query.c.status)).tuples()
    return {str(status.value if isinstance(status, EquipmentStatus) else status): count for status, count in rows}
