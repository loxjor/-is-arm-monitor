"""Роли и учётные записи пользователей ИС."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.organization import Employee


class Role(Base):
    __tablename__ = "role"

    role_id: Mapped[int] = mapped_column(primary_key=True)
    # code — машинный идентификатор для проверки прав (admin, sysadmin, ...);
    # в Т-модели курсового его нет, там только наименование для людей.
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text)


class AppUser(Base):
    __tablename__ = "app_user"

    user_id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("role.role_id"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.employee_id"), unique=True)

    role: Mapped["Role"] = relationship()
    employee: Mapped["Employee"] = relationship()
