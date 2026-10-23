"""Справочники оборудования: тип, производитель, модель, операционная система."""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EquipmentType(Base):
    __tablename__ = "equipment_type"

    type_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    service_life_months: Mapped[int] = mapped_column(SmallInteger)


class Manufacturer(Base):
    __tablename__ = "manufacturer"

    manufacturer_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    country: Mapped[str | None] = mapped_column(String(50))


class EquipmentModel(Base):
    __tablename__ = "equipment_model"

    model_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    specs: Mapped[str | None] = mapped_column(Text)
    type_id: Mapped[int] = mapped_column(ForeignKey("equipment_type.type_id"), index=True)
    manufacturer_id: Mapped[int] = mapped_column(
        ForeignKey("manufacturer.manufacturer_id"), index=True
    )

    equipment_type: Mapped["EquipmentType"] = relationship()
    manufacturer: Mapped["Manufacturer"] = relationship()


class OperatingSystem(Base):
    __tablename__ = "operating_system"

    os_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    version: Mapped[str | None] = mapped_column(String(20))
    is_domestic: Mapped[bool] = mapped_column(Boolean, default=False)
