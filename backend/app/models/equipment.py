"""Реестр оборудования и история назначений."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.catalog import EquipmentModel, OperatingSystem
from app.models.enums import AssignmentOperation, EquipmentStatus, check_enum
from app.models.organization import Employee, Workplace


class Equipment(Base):
    __tablename__ = "equipment"

    equipment_id: Mapped[int] = mapped_column(primary_key=True)
    inventory_no: Mapped[str] = mapped_column(String(20), unique=True)
    serial_no: Mapped[str | None] = mapped_column(String(50))
    cpu: Mapped[str | None] = mapped_column(String(50))
    ram_gb: Mapped[int | None] = mapped_column(SmallInteger)
    storage_gb: Mapped[int | None] = mapped_column(SmallInteger)
    # Характеристики по типу: монитор, принтер/МФУ, сканер/МФУ.
    diagonal_inch: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    resolution: Mapped[str | None] = mapped_column(String(20))
    connection_type: Mapped[str | None] = mapped_column(String(50))
    is_color: Mapped[bool | None] = mapped_column(Boolean)
    cartridge_type: Mapped[str | None] = mapped_column(String(100))
    drum_type: Mapped[str | None] = mapped_column(String(100))
    scan_modes: Mapped[str | None] = mapped_column(String(50))  # коды через запятую
    hostname: Mapped[str | None] = mapped_column(String(50))
    ip_address: Mapped[str | None] = mapped_column(String(20))
    commissioned_on: Mapped[date | None] = mapped_column(Date)
    book_value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    status: Mapped[EquipmentStatus] = mapped_column(
        check_enum(EquipmentStatus, "ck_equipment_status"), default=EquipmentStatus.in_stock
    )
    model_id: Mapped[int] = mapped_column(ForeignKey("equipment_model.model_id"), index=True)
    os_id: Mapped[int | None] = mapped_column(ForeignKey("operating_system.os_id"), index=True)
    workplace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workplace.workplace_id"), index=True
    )
    mol_id: Mapped[int | None] = mapped_column(ForeignKey("employee.employee_id"), index=True)

    model: Mapped["EquipmentModel"] = relationship()
    operating_system: Mapped["OperatingSystem | None"] = relationship()
    workplace: Mapped["Workplace | None"] = relationship()
    mol: Mapped["Employee | None"] = relationship()
    assignments: Mapped[list["Assignment"]] = relationship(
        back_populates="equipment", order_by="Assignment.assigned_at"
    )


class Assignment(Base):
    """Назначение/перемещение — идентифицирующая связь с оборудованием (ОБ-НАЗ)."""

    __tablename__ = "assignment"

    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipment.equipment_id", ondelete="CASCADE"), primary_key=True
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    operation: Mapped[AssignmentOperation] = mapped_column(
        check_enum(AssignmentOperation, "ck_assignment_operation")
    )
    basis: Mapped[str | None] = mapped_column(String(255))
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee.employee_id"), index=True
    )
    workplace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workplace.workplace_id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), index=True)

    equipment: Mapped["Equipment"] = relationship(back_populates="assignments")
    employee: Mapped["Employee | None"] = relationship()
    workplace: Mapped["Workplace | None"] = relationship()
