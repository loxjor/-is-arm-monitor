"""Схемы инвентаризации: территории, помещения, записи и результаты проверки."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DiscrepancyKind, InventoryStatus

_CONFIG = ConfigDict(from_attributes=True, protected_namespaces=())


class InventoryTerritory(BaseModel):
    """Подконтрольная территория (здание) с количеством техники, подлежащей проверке."""

    building_id: int
    name: str
    address: str
    equipment_count: int


class InventoryRoom(BaseModel):
    """Помещение территории с количеством техники в нём."""

    room_id: int
    room_no: str
    floor: int
    equipment_count: int


class InventoryCreate(BaseModel):
    basis: str = Field(min_length=1, max_length=255, description="Основание проведения инвентаризации")
    building_id: int
    room_id: int | None = Field(default=None, description="Кабинет; без него — вся территория")

    model_config = ConfigDict(extra="forbid")


class InventoryRead(BaseModel):
    model_config = _CONFIG

    inventory_id: int
    started_on: date
    finished_on: date | None
    basis: str
    status: InventoryStatus
    building_id: int | None
    building_name: str | None
    room_id: int | None
    room_no: str | None
    responsible_name: str | None
    total_count: int
    checked_count: int
    present_count: int


class InventoryItem(BaseModel):
    equipment_id: int
    inventory_no: str
    serial_no: str | None
    model_name: str
    type_name: str
    manufacturer_name: str
    room_no: str | None
    workplace_no: str | None
    mol_name: str | None
    checked: bool
    is_present: bool
    discrepancy: DiscrepancyKind | None
    note: str | None


class InventoryDetail(InventoryRead):
    items: list[InventoryItem]


class InventoryItemMark(BaseModel):
    """Ручная отметка единицы в инвентаризации: три состояния —
    не проверена (checked=False), в наличии (checked=True, is_present=True),
    не найдена (checked=True, is_present=False)."""

    checked: bool = Field(default=True, description="Единица проверена")
    is_present: bool = Field(default=False, description="Найдена на месте")
    discrepancy: DiscrepancyKind | None = None
    note: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


class InventoryScan(BaseModel):
    """Код, считанный сканером: инвентарный/серийный номер, id или ссылка на карточку."""

    code: str = Field(min_length=1, max_length=255)
