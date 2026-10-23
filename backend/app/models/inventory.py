"""Инвентаризация и её результаты по каждой единице оборудования."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import DiscrepancyKind, InventoryStatus, check_enum


class Inventory(Base):
    __tablename__ = "inventory"

    inventory_id: Mapped[int] = mapped_column(primary_key=True)
    started_on: Mapped[date] = mapped_column(Date)
    finished_on: Mapped[date | None] = mapped_column(Date)
    basis: Mapped[str] = mapped_column(String(255))
    status: Mapped[InventoryStatus] = mapped_column(
        check_enum(InventoryStatus, "ck_inventory_status"), default=InventoryStatus.open
    )
    # NULL — инвентаризация по всему Отделению, а не по одному подразделению.
    dept_id: Mapped[int | None] = mapped_column(ForeignKey("department.dept_id"), index=True)
    responsible_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), index=True)

    results: Mapped[list["InventoryResult"]] = relationship(
        back_populates="inventory", cascade="all, delete-orphan"
    )


class InventoryResult(Base):
    __tablename__ = "inventory_result"

    inventory_id: Mapped[int] = mapped_column(
        ForeignKey("inventory.inventory_id", ondelete="CASCADE"), primary_key=True
    )
    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipment.equipment_id"), primary_key=True
    )
    is_present: Mapped[bool] = mapped_column(Boolean, default=False)
    actual_room_id: Mapped[int | None] = mapped_column(ForeignKey("room.room_id"), index=True)
    discrepancy: Mapped[DiscrepancyKind | None] = mapped_column(
        check_enum(DiscrepancyKind, "ck_inventory_result_discrepancy")
    )
    note: Mapped[str | None] = mapped_column(Text)

    inventory: Mapped["Inventory"] = relationship(back_populates="results")
