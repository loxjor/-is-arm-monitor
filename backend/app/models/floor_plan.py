from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class FloorPlan(Base):
    """План этажа — контейнер для стен и рабочих мест. Все размеры в см."""

    __tablename__ = "floor_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    width_cm: Mapped[float] = mapped_column(Float)
    height_cm: Mapped[float] = mapped_column(Float)
    background_image_url: Mapped[str | None] = mapped_column(String(2048), default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    nodes: Mapped[list["WallNode"]] = relationship(
        back_populates="floor_plan", cascade="all, delete-orphan"
    )
    segments: Mapped[list["WallSegment"]] = relationship(
        back_populates="floor_plan", cascade="all, delete-orphan"
    )
    workspaces: Mapped[list["Workspace"]] = relationship(
        back_populates="floor_plan", cascade="all, delete-orphan"
    )
