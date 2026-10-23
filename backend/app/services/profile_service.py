"""Профиль текущего пользователя: кто он, где работает, какая техника за ним."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import AppUser, Building, Department, Employee, Room, Ticket, TicketStatus, Workplace
from app.schemas.profile import DepartmentBrief, PersonBrief, Profile, Territory
from app.services import equipment_service
from app.services.equipment_service import EquipmentFilters


def _person(employee: Employee) -> PersonBrief:
    return PersonBrief(
        employee_id=employee.employee_id,
        full_name=employee.full_name,
        position=employee.position,
        phone=employee.phone,
        email=employee.email,
    )


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

    open_tickets = db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.requester_id == employee.employee_id,
            Ticket.status.not_in([TicketStatus.closed, TicketStatus.rejected]),
        )
    ) or 0

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
        open_tickets=open_tickets,
    )
