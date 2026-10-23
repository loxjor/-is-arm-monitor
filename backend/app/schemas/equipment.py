from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import AssignmentOperation, EquipmentStatus

# model_id — имя поля из Т-модели; без этого Pydantic ругается на префикс model_.
_CONFIG = ConfigDict(from_attributes=True, protected_namespaces=())


class EquipmentWrite(BaseModel):
    """Постановка на учёт и правка карточки. Статус и размещение здесь не меняются —
    только через назначение/ремонт/списание, чтобы история не расходилась с реестром."""

    model_config = _CONFIG

    inventory_no: str = Field(min_length=1, max_length=20, description="Инвентарный номер (уникален)")
    serial_no: str | None = Field(default=None, max_length=50)
    cpu: str | None = Field(default=None, max_length=50, description="Процессор")
    ram_gb: int | None = Field(default=None, ge=0, le=32767, description="Объём ОЗУ, ГБ")
    storage_gb: int | None = Field(default=None, ge=0, le=32767, description="Объём накопителя, ГБ")
    hostname: str | None = Field(default=None, max_length=50, description="Сетевое имя")
    ip_address: str | None = Field(default=None, max_length=20)
    commissioned_on: date | None = Field(default=None, description="Дата ввода в эксплуатацию")
    book_value: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2,
                                       description="Балансовая стоимость, руб.")
    model_id: int
    os_id: int | None = None
    mol_id: int | None = Field(default=None, description="Материально ответственное лицо")


class EquipmentListItem(BaseModel):
    model_config = _CONFIG

    equipment_id: int
    inventory_no: str
    serial_no: str | None
    hostname: str | None
    status: EquipmentStatus
    model_id: int
    model_name: str
    type_id: int
    type_name: str
    manufacturer_name: str
    os_id: int | None
    os_name: str | None
    workplace_id: int | None
    workplace_no: str | None
    room_id: int | None
    room_no: str | None
    mol_id: int | None
    mol_name: str | None
    holder_id: int | None = Field(description="Сотрудник, которому выдано (последнее назначение)")
    holder_name: str | None
    commissioned_on: date | None
    service_end: date | None = Field(description="Окончание нормативного срока службы")
    book_value: float | None


class AssignmentCreate(BaseModel):
    """Назначение со склада, перемещение или возврат на склад (BPMN 2.6)."""

    operation: AssignmentOperation
    workplace_id: int | None = Field(default=None, description="Рабочее место; для перемещения — новое")
    employee_id: int | None = Field(default=None, description="Сотрудник, которому выдаётся")
    basis: str | None = Field(default=None, max_length=255, description="Основание: заявка, приказ и т. п.")

    @model_validator(mode="after")
    def _check_operation(self) -> "AssignmentCreate":
        if self.operation is AssignmentOperation.assign and self.workplace_id is None:
            raise ValueError("Для назначения укажите рабочее место")
        if self.operation is AssignmentOperation.move and self.workplace_id is None and self.employee_id is None:
            raise ValueError("Для перемещения укажите новое рабочее место или сотрудника")
        if self.operation is AssignmentOperation.return_ and (self.workplace_id or self.employee_id):
            raise ValueError("При возврате на склад рабочее место и сотрудник не указываются")
        return self


class AssignmentRead(BaseModel):
    assigned_at: datetime
    operation: AssignmentOperation
    basis: str | None
    employee_name: str | None
    workplace_no: str | None
    user_login: str


class EquipmentCard(EquipmentListItem):
    cpu: str | None
    ram_gb: int | None
    storage_gb: int | None
    ip_address: str | None
    dept_name: str | None = Field(description="Подразделение помещения, где установлено")
    assignments: list[AssignmentRead]
