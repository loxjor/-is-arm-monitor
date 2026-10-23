from pydantic import BaseModel, Field

from app.core.permissions import DataScope, Permission
from app.schemas.user import UserRead


class LoginRequest(BaseModel):
    login: str = Field(max_length=50)
    password: str = Field(max_length=200)


class CurrentUser(UserRead):
    """Пользователь + вычисленные по роли права — клиент строит по ним меню."""

    permissions: list[Permission]
    scope: DataScope


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: CurrentUser
