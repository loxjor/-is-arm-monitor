"""Схемы справочников. *Create используется и для PUT — запись заменяется целиком.

Числа NUMERIC на входе — Decimal (точность домена D13), на выходе — float,
иначе Pydantic отдал бы их в JSON строками.
"""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

_D13 = {"max_digits": 8, "decimal_places": 2}


class _Read(BaseModel):
    # protected_namespaces=(): поле model_id (Т-модель) иначе конфликтует с
    # зарезервированным в Pydantic префиксом model_.
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=20)
    parent_dept_id: int | None = Field(default=None, description="Вышестоящее подразделение")
    head_employee_id: int | None = Field(default=None, description="Руководитель подразделения")


class DepartmentRead(_Read, DepartmentCreate):
    dept_id: int


class EmployeeCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    position: str = Field(min_length=1, max_length=150)
    phone: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=150, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    is_mol: bool = Field(default=False, description="Материально ответственное лицо")
    dept_id: int


class EmployeeRead(_Read, EmployeeCreate):
    employee_id: int


class BuildingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    address: str = Field(min_length=1, max_length=255)
    floors_count: int | None = Field(default=None, ge=0, le=32767)


class BuildingRead(_Read, BuildingCreate):
    building_id: int


class RoomCreate(BaseModel):
    room_no: str = Field(min_length=1, max_length=20)
    floor: int = Field(ge=-5, le=200)
    area: Decimal | None = Field(default=None, ge=0, description="Площадь, м²", **_D13)
    building_id: int
    dept_id: int | None = None


class RoomRead(_Read):
    room_id: int
    room_no: str
    floor: int
    area: float | None
    building_id: int
    dept_id: int | None


class WorkplaceCreate(BaseModel):
    workplace_no: str = Field(min_length=1, max_length=20)
    x: Decimal = Field(default=Decimal(0), description="Координата X на схеме помещения", **_D13)
    y: Decimal = Field(default=Decimal(0), description="Координата Y на схеме помещения", **_D13)
    room_id: int


class WorkplaceRead(_Read):
    workplace_id: int
    workplace_no: str
    x: float
    y: float
    room_id: int


class EquipmentTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    service_life_months: int = Field(ge=1, le=32767, description="Нормативный срок службы, мес.")


class EquipmentTypeRead(_Read, EquipmentTypeCreate):
    type_id: int


class ManufacturerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    country: str | None = Field(default=None, max_length=50)


class ManufacturerRead(_Read, ManufacturerCreate):
    manufacturer_id: int


class EquipmentModelCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str = Field(min_length=1, max_length=150)
    specs: str | None = Field(default=None, description="Технические характеристики")
    type_id: int
    manufacturer_id: int


class EquipmentModelRead(_Read, EquipmentModelCreate):
    model_id: int


class OperatingSystemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    version: str | None = Field(default=None, max_length=20)
    is_domestic: bool = Field(default=False, description="Входит в реестр отечественного ПО")


class OperatingSystemRead(_Read, OperatingSystemCreate):
    os_id: int
