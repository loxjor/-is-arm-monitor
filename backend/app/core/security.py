"""Хеширование паролей и JWT."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings

_ALGORITHM = "HS256"


class InvalidTokenError(Exception):
    pass


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


# Проверка против этого хеша, когда логин не найден: время ответа не
# выдаёт, существует ли такой пользователь.
DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing")


def create_access_token(user_id: int) -> str:
    # Роль в токен не кладём: она читается из БД на каждом запросе, иначе
    # смена роли или блокировка не действовали бы до истечения токена.
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expires_at}, settings.JWT_SECRET, _ALGORITHM)


def decode_access_token(token: str) -> int:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[_ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as error:
        raise InvalidTokenError from error
