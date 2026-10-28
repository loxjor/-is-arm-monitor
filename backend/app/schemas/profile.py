from pydantic import BaseModel, Field, field_validator

from app.schemas.equipment import EquipmentListItem
from app.schemas.user import _check_password_bytes


class ProfileUpdate(BaseModel):
    """Свои контакты. ФИО, должность, подразделение и роль задаёт администратор."""

    phone: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=150, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    @field_validator("phone", "email", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, description="Не менее 8 символов, не более 72 байт")

    _password_bytes = field_validator("new_password")(_check_password_bytes)


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
