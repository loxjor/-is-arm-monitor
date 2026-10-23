from pydantic import BaseModel, Field

from app.schemas.equipment import EquipmentListItem


class PersonBrief(BaseModel):
    employee_id: int
    full_name: str
    position: str
    phone: str | None
    email: str | None


class DepartmentBrief(BaseModel):
    dept_id: int
    name: str
    short_name: str | None
    phone: str | None
    parent_name: str | None


class Territory(BaseModel):
    """Где сотрудник работает: здание, кабинет и рабочее место — по выданной ему технике."""

    workplace_id: int
    workplace_no: str
    room_no: str
    floor: int
    building_name: str
    building_address: str


class Profile(BaseModel):
    login: str
    role_name: str
    person: PersonBrief
    is_mol: bool
    department: DepartmentBrief
    head: PersonBrief | None = Field(description="Руководитель подразделения")
    territories: list[Territory]
    equipment: list[EquipmentListItem] = Field(description="Техника, выданная сотруднику")
    open_tickets: int = Field(description="Незакрытые заявки сотрудника")
