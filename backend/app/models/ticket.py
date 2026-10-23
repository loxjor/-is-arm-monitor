"""Заявки на обслуживание/установку/перемещение и журнал работ по ним."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import TicketPriority, TicketStatus, TicketType, check_enum


class Ticket(Base):
    __tablename__ = "ticket"

    ticket_id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ticket_type: Mapped[TicketType] = mapped_column(check_enum(TicketType, "ck_ticket_type"))
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[TicketPriority] = mapped_column(
        check_enum(TicketPriority, "ck_ticket_priority"), default=TicketPriority.normal
    )
    status: Mapped[TicketStatus] = mapped_column(
        check_enum(TicketStatus, "ck_ticket_status"), default=TicketStatus.new
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    equipment_id: Mapped[int | None] = mapped_column(
        ForeignKey("equipment.equipment_id"), index=True
    )
    requester_id: Mapped[int] = mapped_column(ForeignKey("employee.employee_id"), index=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.user_id"), index=True)

    works: Mapped[list["TicketWork"]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", order_by="TicketWork.work_no"
    )


class TicketWork(Base):
    """Работа по заявке — идентифицирующая связь (ЗАЯ-РАБ), номер работы в пределах заявки."""

    __tablename__ = "ticket_work"

    ticket_id: Mapped[int] = mapped_column(
        ForeignKey("ticket.ticket_id", ondelete="CASCADE"), primary_key=True
    )
    work_no: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    performed_at: Mapped[datetime] = mapped_column(DateTime)
    description: Mapped[str] = mapped_column(Text)
    minutes_spent: Mapped[int | None] = mapped_column(SmallInteger)
    result: Mapped[str | None] = mapped_column(String(255))
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), index=True)

    ticket: Mapped["Ticket"] = relationship(back_populates="works")
