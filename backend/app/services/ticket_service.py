"""Заявки на установку, перемещение, обслуживание и ремонт (А3, BPMN 2.7).

Переходы статусов описаны в одном месте (_TRANSITIONS); комментарий к
переходу сохраняется записью в журнале работ, чтобы причина отклонения или
итог ремонта не терялись.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, joinedload

from app.core.permissions import ROLE_SCOPE, DataScope, Permission, RoleCode, has_permission
from app.models import (
    AppUser,
    Employee,
    Equipment,
    EquipmentStatus,
    Ticket,
    TicketStatus,
    TicketType,
    TicketWork,
    WriteoffAct,
)
from app.schemas.ticket import (
    TicketCard,
    TicketCreate,
    TicketListItem,
    TicketTransition,
    TicketWorkCreate,
    TicketWorkRead,
)
from app.services import audit_service, equipment_service
from app.services.errors import ConflictError, NotFoundError


class ForbiddenError(PermissionError):
    pass


# Допустимые переходы и кто их выполняет: исполнитель (право process_tickets)
# или заявитель.
_TRANSITIONS: dict[TicketStatus, dict[TicketStatus, str]] = {
    TicketStatus.new: {TicketStatus.in_progress: "processor", TicketStatus.rejected: "processor"},
    TicketStatus.in_progress: {TicketStatus.done: "processor"},
    TicketStatus.done: {TicketStatus.closed: "requester", TicketStatus.in_progress: "requester"},
}

_STATUS_TITLES = {
    TicketStatus.new: "Новая",
    TicketStatus.in_progress: "В работе",
    TicketStatus.done: "Выполнена",
    TicketStatus.rejected: "Отклонена",
    TicketStatus.closed: "Закрыта",
}

_NEEDS_EQUIPMENT = {TicketType.service, TicketType.repair}


@dataclass(frozen=True)
class TicketFilters:
    status: TicketStatus | None = None
    ticket_type: TicketType | None = None
    equipment_id: int | None = None
    assigned_to_me: bool = False
    q: str | None = None


def _is_processor(user: AppUser) -> bool:
    return has_permission(RoleCode(user.role.code), Permission.process_tickets)


def _loaded() -> Select[tuple[Ticket]]:
    return select(Ticket).options(
        joinedload(Ticket.equipment),
        joinedload(Ticket.requester),
        joinedload(Ticket.assignee).joinedload(AppUser.employee),
    )


def _apply_scope(query: Select[tuple[Ticket]], user: AppUser) -> Select[tuple[Ticket]]:
    """Сотрудник видит свои заявки, руководитель — заявки своего подразделения."""
    scope = ROLE_SCOPE[RoleCode(user.role.code)]
    if scope is DataScope.all:
        return query
    if scope is DataScope.own:
        return query.where(Ticket.requester_id == user.employee_id)
    in_department = select(Employee.employee_id).where(Employee.dept_id == user.employee.dept_id)
    return query.where(Ticket.requester_id.in_(in_department))


def _allowed_targets(ticket: Ticket, user: AppUser) -> list[TicketStatus]:
    processor = _is_processor(user)
    requester = ticket.requester_id == user.employee_id
    return [
        target
        for target, actor in _TRANSITIONS.get(ticket.status, {}).items()
        # Исполнитель может закрыть или вернуть заявку и за заявителя — например, по звонку.
        if processor or (actor == "requester" and requester)
    ]


def _to_item(ticket: Ticket) -> TicketListItem:
    assignee = ticket.assignee
    return TicketListItem(
        ticket_id=ticket.ticket_id,
        created_at=ticket.created_at,
        ticket_type=ticket.ticket_type,
        description=ticket.description,
        priority=ticket.priority,
        status=ticket.status,
        closed_at=ticket.closed_at,
        equipment_id=ticket.equipment_id,
        inventory_no=ticket.equipment.inventory_no if ticket.equipment else None,
        requester_id=ticket.requester_id,
        requester_name=ticket.requester.full_name,
        assignee_id=ticket.assignee_id,
        assignee_name=assignee.employee.full_name if assignee else None,
    )


def list_tickets(
    db: Session, user: AppUser, filters: TicketFilters, *, limit: int, offset: int
) -> tuple[list[TicketListItem], int]:
    query = _apply_scope(_loaded(), user)
    if filters.status is not None:
        query = query.where(Ticket.status == filters.status)
    if filters.ticket_type is not None:
        query = query.where(Ticket.ticket_type == filters.ticket_type)
    if filters.equipment_id is not None:
        query = query.where(Ticket.equipment_id == filters.equipment_id)
    if filters.assigned_to_me:
        query = query.where(Ticket.assignee_id == user.user_id)
    if filters.q:
        query = query.where(Ticket.description.ilike(f"%{filters.q.strip()}%"))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(Ticket.created_at.desc(), Ticket.ticket_id.desc()).limit(limit).offset(offset))
    return [_to_item(t) for t in rows.unique()], total


def status_counts(db: Session, user: AppUser) -> dict[str, int]:
    scoped = _apply_scope(select(Ticket), user).subquery()
    rows = db.execute(select(scoped.c.status, func.count()).group_by(scoped.c.status)).tuples()
    return {str(status.value if isinstance(status, TicketStatus) else status): count for status, count in rows}


def _get_visible(db: Session, user: AppUser, ticket_id: int) -> Ticket:
    ticket = db.scalars(_apply_scope(_loaded(), user).where(Ticket.ticket_id == ticket_id)).unique().one_or_none()
    if ticket is None:
        raise NotFoundError("Заявка не найдена")
    return ticket


def get_card(db: Session, user: AppUser, ticket_id: int) -> TicketCard:
    ticket = _get_visible(db, user, ticket_id)
    logins = {
        user_id: login
        for user_id, login in db.execute(
            select(AppUser.user_id, AppUser.login).where(AppUser.user_id.in_({w.user_id for w in ticket.works}))
        ).tuples()
    }
    return TicketCard(
        **_to_item(ticket).model_dump(),
        works=[
            TicketWorkRead(
                work_no=w.work_no,
                performed_at=w.performed_at,
                description=w.description,
                minutes_spent=w.minutes_spent,
                result=w.result,
                user_login=logins.get(w.user_id, "?"),
            )
            for w in ticket.works
        ],
        can_transition_to=_allowed_targets(ticket, user),
        can_add_work=_is_processor(user) and ticket.status is TicketStatus.in_progress,
    )


def create(db: Session, user: AppUser, data: TicketCreate) -> TicketCard:
    if data.ticket_type in _NEEDS_EQUIPMENT and data.equipment_id is None:
        raise ConflictError("Для ремонта и обслуживания выберите оборудование")
    if data.equipment_id is not None:
        # Подать заявку можно только на видимое пользователю оборудование (своё / своего подразделения).
        equipment = equipment_service.get_visible(db, user, data.equipment_id)
        if equipment.status is EquipmentStatus.written_off:
            raise ConflictError("Оборудование списано")

    ticket = Ticket(
        created_at=datetime.now(),
        ticket_type=data.ticket_type,
        description=data.description,
        priority=data.priority,
        status=TicketStatus.new,
        equipment_id=data.equipment_id,
        requester_id=user.employee_id,
    )
    db.add(ticket)
    db.flush()
    audit_service.record(
        db, user_id=user.user_id, action="create", entity="ticket", entity_id=ticket.ticket_id,
        details={"ticket_type": data.ticket_type.value, "equipment_id": data.equipment_id},
    )
    db.commit()
    return get_card(db, user, ticket.ticket_id)


def _add_work(db: Session, ticket: Ticket, user: AppUser, description: str, *,
              minutes_spent: int | None = None, result: str | None = None) -> TicketWork:
    work_no = (db.scalar(select(func.max(TicketWork.work_no)).where(TicketWork.ticket_id == ticket.ticket_id)) or 0) + 1
    work = TicketWork(
        ticket_id=ticket.ticket_id,
        work_no=work_no,
        performed_at=datetime.now(),
        description=description,
        minutes_spent=minutes_spent,
        result=result,
        user_id=user.user_id,
    )
    db.add(work)
    return work


def add_work(db: Session, user: AppUser, ticket_id: int, data: TicketWorkCreate) -> TicketCard:
    ticket = _get_visible(db, user, ticket_id)
    if not _is_processor(user):
        raise ForbiddenError("Журнал работ ведёт исполнитель")
    if ticket.status is not TicketStatus.in_progress:
        raise ConflictError("Записи в журнал добавляются только по заявке в работе")
    work = _add_work(db, ticket, user, data.description, minutes_spent=data.minutes_spent, result=data.result)
    db.flush()
    audit_service.record(
        db, user_id=user.user_id, action="create", entity="ticket_work",
        entity_id=f"{ticket_id}/{work.work_no}", details={"description": data.description},
    )
    db.commit()
    db.expire_all()
    return get_card(db, user, ticket_id)


def _draft_writeoff(db: Session, ticket: Ticket, user: AppUser, conclusion: str) -> None:
    existing = db.scalar(select(WriteoffAct).where(WriteoffAct.equipment_id == ticket.equipment_id))
    if existing is not None:
        return
    db.add(
        WriteoffAct(
            act_date=date.today(),
            reason=f"Не подлежит ремонту (заявка № {ticket.ticket_id})",
            tech_conclusion=conclusion,
            equipment_id=ticket.equipment_id,
            user_id=user.user_id,
        )
    )


def _set_equipment_status(equipment: Equipment, new_status: EquipmentStatus) -> dict[str, str] | None:
    if equipment.status is new_status:
        return None
    change = {"from": equipment.status.value, "to": new_status.value}
    equipment.status = new_status
    return change


def transition(db: Session, user: AppUser, ticket_id: int, data: TicketTransition) -> TicketCard:
    ticket = _get_visible(db, user, ticket_id)
    current = ticket.status
    if data.to not in _TRANSITIONS.get(current, {}):
        raise ConflictError(f"Из статуса «{_STATUS_TITLES[current]}» нельзя перейти в «{_STATUS_TITLES[data.to]}»")
    if data.to not in _allowed_targets(ticket, user):
        raise ForbiddenError("Недостаточно прав для этого перехода")
    if data.to is TicketStatus.rejected and not data.comment:
        raise ConflictError("Укажите причину отклонения")
    if data.unrepairable and (data.to is not TicketStatus.done or ticket.equipment is None):
        raise ConflictError("Признак «не подлежит ремонту» ставится при выполнении заявки на оборудование")

    equipment = ticket.equipment
    equipment_change: dict[str, str] | None = None

    if data.to is TicketStatus.in_progress:
        if current is TicketStatus.new:
            ticket.assignee_id = user.user_id
        ticket.closed_at = None
        if (ticket.ticket_type is TicketType.repair and equipment is not None
                and equipment.status in (EquipmentStatus.in_use, EquipmentStatus.in_stock)):
            equipment_change = _set_equipment_status(equipment, EquipmentStatus.in_repair)
    elif data.to is TicketStatus.done and equipment is not None:
        if data.unrepairable:
            equipment_change = _set_equipment_status(equipment, EquipmentStatus.pending_writeoff)
            _draft_writeoff(db, ticket, user, data.comment or "Не подлежит ремонту по результатам диагностики")
        elif equipment.status is EquipmentStatus.in_repair:
            back = EquipmentStatus.in_use if equipment.workplace_id else EquipmentStatus.in_stock
            equipment_change = _set_equipment_status(equipment, back)
    elif data.to in (TicketStatus.closed, TicketStatus.rejected):
        ticket.closed_at = datetime.now()

    if data.comment:
        result = "Не подлежит ремонту" if data.unrepairable else _STATUS_TITLES[data.to]
        _add_work(db, ticket, user, data.comment, result=result)
    ticket.status = data.to

    audit_service.record(
        db, user_id=user.user_id, action="status_change", entity="ticket", entity_id=ticket_id,
        details={"status": {"from": current.value, "to": data.to.value}, "equipment_status": equipment_change},
    )
    db.commit()
    db.expire_all()
    return get_card(db, user, ticket_id)
