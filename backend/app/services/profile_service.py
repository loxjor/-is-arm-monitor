"""Профиль текущего пользователя: кто он, где работает, какая техника за ним."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import AppUser, Building, Department, Employee, Room, Workplace
from app.core.security import hash_password, verify_password
from app.schemas.profile import DepartmentBrief, PasswordChange, PersonBrief, Profile, ProfileUpdate, Territory
from app.services import audit_service, equipment_service
from app.services.equipment_service import EquipmentFilters
from app.services.errors import ConflictError


def _person(employee: Employee) -> PersonBrief:
    return PersonBrief(
        employee_id=employee.employee_id,
        full_name=employee.full_name,
        position=employee.position,
        phone=employee.phone,
        email=employee.email,
    )


def update_profile(db: Session, user: AppUser, data: ProfileUpdate) -> Profile:
    employee = user.employee
    values = data.model_dump()
    changes = {
        name: {"from": getattr(employee, name), "to": value}
        for name, value in values.items()
        if getattr(employee, name) != value
    }
    for name, value in values.items():
        setattr(employee, name, value)
    if changes:
        audit_service.record(
            db, user_id=user.user_id, action="update", entity="employee", entity_id=employee.employee_id,
            details=changes,
        )
    db.commit()
    return get_profile(db, user)


def change_password(db: Session, user: AppUser, data: PasswordChange) -> None:
    if not verify_password(data.current_password, user.password_hash):
        raise ConflictError("Текущий пароль указан неверно")
    if data.new_password == data.current_password:
        raise ConflictError("Новый пароль совпадает с текущим")
    user.password_hash = hash_password(data.new_password)
    audit_service.record(
        db, user_id=user.user_id, action="update", entity="app_user", entity_id=user.user_id,
        details={"password": "changed"},
    )
    db.commit()


def get_profile(db: Session, user: AppUser) -> Profile:
    employee = user.employee
    department = db.scalars(
        select(Department)
        .options(joinedload(Department.parent), joinedload(Department.head))
        .where(Department.dept_id == employee.dept_id)
    ).one()

    equipment, _ = equipment_service.list_equipment(
        db, user, EquipmentFilters(holder_id=employee.employee_id), limit=500, offset=0
    )
    workplace_ids = sorted({item.workplace_id for item in equipment if item.workplace_id is not None})
    territories = [
        Territory(
            workplace_id=workplace.workplace_id,
            workplace_no=workplace.workplace_no,
            room_no=room.room_no,
            floor=room.floor,
            building_name=building.name,
            building_address=building.address,
        )
        for workplace, room, building in db.execute(
            select(Workplace, Room, Building)
            .join(Room, Workplace.room_id == Room.room_id)
            .join(Building, Room.building_id == Building.building_id)
            .where(Workplace.workplace_id.in_(workplace_ids))
            .order_by(Workplace.workplace_no)
        ).tuples()
    ]

    return Profile(
        login=user.login,
        role_name=user.role.name,
        person=_person(employee),
        is_mol=employee.is_mol,
        department=DepartmentBrief(
            dept_id=department.dept_id,
            name=department.name,
            short_name=department.short_name,
            phone=department.phone,
            parent_name=department.parent.name if department.parent else None,
        ),
        head=_person(department.head) if department.head else None,
        territories=territories,
        equipment=equipment,
    )
