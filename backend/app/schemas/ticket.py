from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import TicketPriority, TicketStatus, TicketType


class TicketCreate(BaseModel):
    ticket_type: TicketType
    description: str = Field(min_length=3, max_length=4000, description="Описание проблемы или потребности")
    priority: TicketPriority = TicketPriority.normal
    equipment_id: int | None = Field(default=None, description="Оборудование; для ремонта и обслуживания обязательно")


class TicketTransition(BaseModel):
    """Смена статуса заявки (BPMN 2.7)."""

    to: TicketStatus
    comment: str | None = Field(default=None, max_length=255, description="Причина отклонения / возврата, итог работ")
    unrepairable: bool = Field(default=False, description="При выполнении: оборудование не подлежит ремонту")


class TicketWorkCreate(BaseModel):
    description: str = Field(min_length=3, max_length=4000, description="Содержание работ")
    minutes_spent: int | None = Field(default=None, ge=0, le=32767)
    result: str | None = Field(default=None, max_length=255)


class TicketWorkRead(BaseModel):
    work_no: int
    performed_at: datetime
    description: str
    minutes_spent: int | None
    result: str | None
    user_login: str


class TicketListItem(BaseModel):
    ticket_id: int
    created_at: datetime
    ticket_type: TicketType
    description: str
    priority: TicketPriority
    status: TicketStatus
    closed_at: datetime | None
    equipment_id: int | None
    inventory_no: str | None
    requester_id: int
    requester_name: str
    assignee_id: int | None
    assignee_name: str | None


class TicketCard(TicketListItem):
    works: list[TicketWorkRead]
    can_transition_to: list[TicketStatus] = Field(description="Куда текущий пользователь может перевести заявку")
    can_add_work: bool
