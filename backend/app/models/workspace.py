from __future__ import annotations

import enum

from sqlalchemy import CheckConstraint, Enum, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class WorkspaceStatus(str, enum.Enum):
    free = "free"
    occupied = "occupied"
    reserved = "reserved"


class Workspace(Base):
    """
    Рабочее место. x/y/width/height — см, rotation — градусы. client_id —
    id места на фронтенде, постоянный между сохранениями: по нему PUT
    обновляет строку на месте, а не пересоздаёт, так что id строки не
    меняется и на него можно ссылаться (назначения сотрудников, активов).
    """

    __tablename__ = "workspaces"
    __table_args__ = (
        UniqueConstraint("floor_plan_id", "client_id", name="uq_workspaces_floor_plan_client_id"),
        CheckConstraint("width > 0", name="width_positive"),
        CheckConstraint("height > 0", name="height_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_plan_id: Mapped[int] = mapped_column(
        ForeignKey("floor_plans.id", ondelete="CASCADE"), index=True
    )
    client_id: Mapped[str] = mapped_column(String(64))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float)
    rotation: Mapped[float] = mapped_column(Float)
    label: Mapped[str] = mapped_column(String(255))
    status: Mapped[WorkspaceStatus] = mapped_column(
        Enum(WorkspaceStatus, name="workspace_status", native_enum=True)
    )
    # id этажа из scene.floors; NULL — первый этаж (места из планов до этажей).
    floor_id: Mapped[str | None] = mapped_column(String(64), default=None)

    floor_plan: Mapped["FloorPlan"] = relationship(back_populates="workspaces")
