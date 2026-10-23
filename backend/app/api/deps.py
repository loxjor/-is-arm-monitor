"""Зависимости FastAPI: текущий пользователь и проверка прав."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.permissions import Permission, RoleCode, has_permission
from app.core.security import InvalidTokenError, decode_access_token
from app.db.session import get_db
from app.models import AppUser

# HTTPBearer, а не OAuth2PasswordBearer: вход принимает JSON, а форма
# password flow в Swagger потребовала бы python-multipart.
_bearer = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Требуется вход в систему",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> AppUser:
    if credentials is None:
        raise _unauthorized()
    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError:
        raise _unauthorized()
    user = db.get(AppUser, user_id)
    # Блокировка действует сразу, не дожидаясь истечения токена.
    if user is None or not user.is_active:
        raise _unauthorized()
    return user


def require(permission: Permission) -> Callable[..., AppUser]:
    def dependency(user: AppUser = Depends(get_current_user)) -> AppUser:
        if not has_permission(RoleCode(user.role.code), permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        return user

    return dependency
