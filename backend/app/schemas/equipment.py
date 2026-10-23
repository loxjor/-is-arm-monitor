from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

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
    commissioned_on: date | None
    service_end: date | None = Field(description="Окончание нормативного срока службы")
    book_value: float | None


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
