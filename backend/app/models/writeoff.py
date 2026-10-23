"""Акт списания оборудования."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import ApprovalStatus, check_enum


class WriteoffAct(Base):
    __tablename__ = "writeoff_act"

    act_id: Mapped[int] = mapped_column(primary_key=True)
    act_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(String(255))
    tech_conclusion: Mapped[str] = mapped_column(Text)
    approval_status: Mapped[ApprovalStatus] = mapped_column(
        check_enum(ApprovalStatus, "ck_writeoff_act_approval_status"),
        default=ApprovalStatus.draft,
    )
    # unique — связь ОБ-АКТ 1:1: на единицу оборудования не больше одного акта.
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.equipment_id"), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), index=True)
