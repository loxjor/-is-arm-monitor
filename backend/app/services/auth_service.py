from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import DUMMY_PASSWORD_HASH, verify_password
from app.models import AppUser
from app.services import audit_service


class AuthenticationError(Exception):
    pass


def authenticate(db: Session, login: str, password: str) -> AppUser:
    """Проверяет логин/пароль, пишет в журнал и успешный, и неудачный вход."""
    user = db.scalar(select(AppUser).where(AppUser.login == login))
    password_ok = verify_password(password, user.password_hash if user else DUMMY_PASSWORD_HASH)

    if user is None or not password_ok or not user.is_active:
        reason = "unknown_login" if user is None else "wrong_password" if not password_ok else "inactive"
        audit_service.record(
            db,
            user_id=user.user_id if user else None,
            action="login_failed",
            entity="app_user",
            details={"login": login, "reason": reason},
        )
        db.commit()
        # Одно сообщение на все причины — ответ не подсказывает, какой логин существует.
        raise AuthenticationError("Неверный логин или пароль")

    user.last_login_at = datetime.now()
    audit_service.record(db, user_id=user.user_id, action="login", entity="app_user", entity_id=user.user_id)
    db.commit()
    return user
