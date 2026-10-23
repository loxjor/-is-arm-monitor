"""Оргструктура и помещения: подразделение, сотрудник, здание, помещение, рабочее место."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, LargeBinary, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Department(Base):
    __tablename__ = "department"

    dept_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    short_name: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(20))
    parent_dept_id: Mapped[int | None] = mapped_column(ForeignKey("department.dept_id"))
    # Руководитель — сверх Т-модели курсового. use_alter: department и employee
    # ссылаются друг на друга, FK добавляется после создания обеих таблиц.
    head_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee.employee_id", use_alter=True, name="fk_department_head_employee_id")
    )

    parent: Mapped["Department | None"] = relationship(
        remote_side="Department.dept_id", back_populates="children"
    )
    children: Mapped[list["Department"]] = relationship(back_populates="parent")
    employees: Mapped[list["Employee"]] = relationship(
        back_populates="department", foreign_keys="Employee.dept_id"
    )
    head: Mapped["Employee | None"] = relationship(foreign_keys=[head_employee_id])


class Employee(Base):
    __tablename__ = "employee"

    employee_id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(150))
    position: Mapped[str] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(150))
    is_mol: Mapped[bool] = mapped_column(Boolean, default=False)
    dept_id: Mapped[int] = mapped_column(ForeignKey("department.dept_id"), index=True)

    department: Mapped["Department"] = relationship(back_populates="employees", foreign_keys=[dept_id])


class Building(Base):
    __tablename__ = "building"

    building_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    address: Mapped[str] = mapped_column(String(255))
    floors_count: Mapped[int | None] = mapped_column(SmallInteger)

    rooms: Mapped[list["Room"]] = relationship(back_populates="building")


class Room(Base):
    __tablename__ = "room"

    room_id: Mapped[int] = mapped_column(primary_key=True)
    room_no: Mapped[str] = mapped_column(String(20))
    floor: Mapped[int] = mapped_column(SmallInteger)
    area: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    plan: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    building_id: Mapped[int] = mapped_column(ForeignKey("building.building_id"), index=True)
    dept_id: Mapped[int | None] = mapped_column(ForeignKey("department.dept_id"), index=True)

    building: Mapped["Building"] = relationship(back_populates="rooms")
    department: Mapped["Department | None"] = relationship()
    workplaces: Mapped[list["Workplace"]] = relationship(back_populates="room")


class Workplace(Base):
    """Рабочее место в помещении. x/y — координаты на схеме помещения."""

    __tablename__ = "workplace"

    workplace_id: Mapped[int] = mapped_column(primary_key=True)
    workplace_no: Mapped[str] = mapped_column(String(20))
    x: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    y: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    room_id: Mapped[int] = mapped_column(ForeignKey("room.room_id"), index=True)

    room: Mapped["Room"] = relationship(back_populates="workplaces")
