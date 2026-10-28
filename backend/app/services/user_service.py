"""Учётные записи пользователей ИС. Удаления нет — только блокировка (is_active)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import hash_password
from app.models import AppUser, Employee, Role
from app.schemas.user import UserCreate, UserUpdate
from app.services import audit_service
from app.services.errors import ConflictError, NotFoundError


def list_roles(db: Session) -> list[Role]:
    return list(db.scalars(select(Role).order_by(Role.role_id)))


def list_users(db: Session) -> list[AppUser]:
    # UserRead вкладывает роль и сотрудника — без selectinload это N+1.
    return list(
        db.scalars(
            select(AppUser)
            .options(selectinload(AppUser.role), selectinload(AppUser.employee))
            .order_by(AppUser.login)
        )
    )


def get_user(db: Session, user_id: int) -> AppUser:
    user = db.get(AppUser, user_id)
    if user is None:
        raise NotFoundError("Пользователь не найден")
    return user


def _require_role(db: Session, role_id: int) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise NotFoundError("Роль не найдена")
    return role


def create_user(db: Session, data: UserCreate, *, actor_id: int) -> AppUser:
    _require_role(db, data.role_id)
    if db.get(Employee, data.employee_id) is None:
        raise NotFoundError("Сотрудник не найден")
    if db.scalar(select(AppUser).where(AppUser.login == data.login)) is not None:
        raise ConflictError("Логин уже занят")
    if db.scalar(select(AppUser).where(AppUser.employee_id == data.employee_id)) is not None:
        raise ConflictError("У сотрудника уже есть учётная запись")

    user = AppUser(
        login=data.login,
        password_hash=hash_password(data.password),
        role_id=data.role_id,
        employee_id=data.employee_id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    audit_service.record(
        db,
        user_id=actor_id,
        action="create",
        entity="app_user",
        entity_id=user.user_id,
        details={"login": user.login, "role_id": user.role_id, "employee_id": user.employee_id},
    )
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user_id: int, data: UserUpdate, *, actor_id: int) -> AppUser:
    user = get_user(db, user_id)
    changes: dict[str, object] = {}

    if data.role_id is not None and data.role_id != user.role_id:
        _require_role(db, data.role_id)
        changes["role_id"] = {"from": user.role_id, "to": data.role_id}
        user.role_id = data.role_id
    if data.is_active is not None and data.is_active != user.is_active:
        if user.user_id == actor_id and not data.is_active:
            raise ConflictError("Нельзя заблокировать собственную учётную запись")
        changes["is_active"] = {"from": user.is_active, "to": data.is_active}
        user.is_active = data.is_active
    if data.password is not None:
        user.password_hash = hash_password(data.password)
        # Сам пароль и хеш в журнал не попадают — только факт сброса.
        changes["password"] = "reset"

    if changes:
        audit_service.record(
            db, user_id=actor_id, action="update", entity="app_user", entity_id=user.user_id, details=changes
        )
        db.commit()
        db.refresh(user)
    return user
