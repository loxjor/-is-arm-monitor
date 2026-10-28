from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import AssignmentOperation, EquipmentStatus

SCAN_MODE_ORDER = ("flatbed", "feeder", "duplex_feeder")  # со стекла, потоковая, потоковая двусторонняя
SCAN_MODES = set(SCAN_MODE_ORDER)

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
    diagonal_inch: Decimal | None = Field(default=None, gt=0, max_digits=4, decimal_places=1,
                                          description="Диагональ монитора, дюймы")
    resolution: str | None = Field(default=None, max_length=20, description="Разрешение, напр. 1920×1080")
    connection_type: str | None = Field(default=None, max_length=50, description="Подключение монитора")
    is_color: bool | None = Field(default=None, description="Цветная печать (принтер, МФУ)")
    cartridge_type: str | None = Field(default=None, max_length=100, description="Тип картриджей")
    drum_type: str | None = Field(default=None, max_length=100, description="Тип барабанов")
    scan_modes: str | None = Field(default=None, max_length=50,
                                   description="Режимы сканирования через запятую: flatbed, feeder, duplex_feeder")
    # Модель — либо из справочника (model_id), либо по тексту: тип + производитель + модель.
    # Нового производителя и модель сервис заводит в справочниках сам.
    model_id: int | None = None
    type_id: int | None = None
    manufacturer_name: str | None = Field(default=None, max_length=50)
    model_name: str | None = Field(default=None, max_length=150)
    os_id: int | None = None
    mol_id: int | None = Field(default=None, description="Материально ответственное лицо")

    @field_validator("manufacturer_name", "model_name")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        return value.strip() or None if value else None

    @field_validator("scan_modes")
    @classmethod
    def _check_scan_modes(cls, value: str | None) -> str | None:
        if not value:
            return None
        modes = [m.strip() for m in value.split(",") if m.strip()]
        unknown = set(modes) - SCAN_MODES
        if unknown:
            raise ValueError(f"Неизвестный режим сканирования: {', '.join(sorted(unknown))}")
        return ",".join(m for m in SCAN_MODE_ORDER if m in modes) or None

    @model_validator(mode="after")
    def _check_model(self) -> "EquipmentWrite":
        if self.model_id is None and not (self.type_id and self.manufacturer_name and self.model_name):
            raise ValueError("Укажите тип оборудования, производителя и модель")
        return self


class ModelSpecs(BaseModel):
    """Характеристики модели — как они были заданы при первой постановке на учёт такой модели."""

    cpu: str | None = None
    ram_gb: int | None = None
    storage_gb: int | None = None
    diagonal_inch: float | None = None
    resolution: str | None = None
    connection_type: str | None = None
    is_color: bool | None = None
    cartridge_type: str | None = None
    drum_type: str | None = None
    scan_modes: str | None = None


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
    building_address: str | None
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
    diagonal_inch: float | None
    resolution: str | None
    connection_type: str | None
    is_color: bool | None
    cartridge_type: str | None
    drum_type: str | None
    scan_modes: str | None
    dept_name: str | None = Field(description="Подразделение помещения, где установлено")
    assignments: list[AssignmentRead]
