from __future__ import annotations

import enum

from sqlalchemy import Enum, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class WorkspaceStatus(str, enum.Enum):
    free = "free"
    occupied = "occupied"
    reserved = "reserved"


class Workspace(Base):
    """Рабочее место. x/y/width/height — см, rotation — градусы."""

    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_plan_id: Mapped[int] = mapped_column(
        ForeignKey("floor_plans.id", ondelete="CASCADE"), index=True
    )
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float)
    rotation: Mapped[float] = mapped_column(Float)
    label: Mapped[str] = mapped_column(String(255))
    status: Mapped[WorkspaceStatus] = mapped_column(
        Enum(WorkspaceStatus, name="workspace_status", native_enum=True)
    )

    floor_plan: Mapped["FloorPlan"] = relationship(back_populates="workspaces")
