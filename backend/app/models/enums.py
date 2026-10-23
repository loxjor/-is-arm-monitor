"""Перечисления учётной части. В БД — VARCHAR(20) + CHECK (домен D4), не native enum."""

from __future__ import annotations

import enum

from sqlalchemy import Enum


class EquipmentStatus(str, enum.Enum):
    in_stock = "in_stock"
    in_use = "in_use"
    in_repair = "in_repair"
    pending_writeoff = "pending_writeoff"
    written_off = "written_off"


class AssignmentOperation(str, enum.Enum):
    assign = "assign"
    move = "move"
    return_ = "return"


class TicketType(str, enum.Enum):
    install = "install"
    move = "move"
    service = "service"
    repair = "repair"


class TicketPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"


class TicketStatus(str, enum.Enum):
    new = "new"
    in_progress = "in_progress"
    done = "done"
    rejected = "rejected"
    closed = "closed"


class InventoryStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class DiscrepancyKind(str, enum.Enum):
    missing = "missing"
    wrong_room = "wrong_room"
    extra = "extra"


class ApprovalStatus(str, enum.Enum):
    draft = "draft"
    on_approval = "on_approval"
    approved = "approved"
    rejected = "rejected"


def check_enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    # values_callable: в БД пишется значение, а не имя члена — иначе
    # AssignmentOperation.return_ легло бы строкой "return_".
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda e: [m.value for m in e],
    )
