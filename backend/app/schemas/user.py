from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.permissions import RoleCode


def _check_password_bytes(password: str | None) -> str | None:
    # bcrypt учитывает только первые 72 байта; кириллица — 2 байта на символ,
    # поэтому ограничения по символам из Field недостаточно.
    if password is not None and len(password.encode()) > 72:
        raise ValueError("Пароль длиннее 72 байт")
    return password


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role_id: int
    code: RoleCode
    name: str
    description: str | None


class EmployeeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    full_name: str
    dept_id: int


class UserCreate(BaseModel):
    login: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=8, description="Не менее 8 символов, не более 72 байт")
    role_id: int
    employee_id: int = Field(description="Сотрудник, за которым закрепляется учётная запись (1:1)")

    _password_bytes = field_validator("password")(_check_password_bytes)


class UserUpdate(BaseModel):
    """Все поля необязательны: меняется только присланное."""

    role_id: int | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, description="Новый пароль (сброс)")

    _password_bytes = field_validator("password")(_check_password_bytes)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    login: str
    is_active: bool
    last_login_at: datetime | None
    role: RoleRead
    employee: EmployeeBrief
