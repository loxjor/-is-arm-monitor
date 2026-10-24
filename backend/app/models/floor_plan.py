from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# В PostgreSQL — JSONB, в SQLite (локальная разработка, тесты) — обычный JSON.
SceneJSON = JSON().with_variant(JSONB(), "postgresql")


class FloorPlan(Base):
    """
    План этажа. Геометрия (узлы и сегменты стен, двери и окна) хранится одним
    документом scene: она всегда читается и пишется целиком вместе с планом,
    никто не ссылается на неё внешними ключами, а формат меняется вместе с
    фронтендом — версия документа лежит рядом в scene_version. Рабочие места,
    наоборот, отдельная таблица: по ним нужны фильтры и связи. Размеры — см.
    """

    __tablename__ = "floor_plans"
    __table_args__ = (
        CheckConstraint("width_cm > 0", name="width_positive"),
        CheckConstraint("height_cm > 0", name="height_positive"),
        CheckConstraint("scene_version BETWEEN 2 AND 3", name="scene_version_known"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    width_cm: Mapped[float] = mapped_column(Float)
    height_cm: Mapped[float] = mapped_column(Float)
    background_image_url: Mapped[str | None] = mapped_column(String(2048), default=None)
    scene: Mapped[dict[str, Any]] = mapped_column(SceneJSON)
    scene_version: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    workspaces: Mapped[list["Workspace"]] = relationship(
        back_populates="floor_plan", cascade="all, delete-orphan", order_by="Workspace.id"
    )
