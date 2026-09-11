from __future__ import annotations

from sqlalchemy import Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Wall(Base):
    """Сегмент стены. x/y/length/thickness — см, rotation — градусы."""

    __tablename__ = "walls"

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_plan_id: Mapped[int] = mapped_column(
        ForeignKey("floor_plans.id", ondelete="CASCADE"), index=True
    )
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    length: Mapped[float] = mapped_column(Float)
    thickness: Mapped[float] = mapped_column(Float)
    rotation: Mapped[float] = mapped_column(Float)

    floor_plan: Mapped["FloorPlan"] = relationship(back_populates="walls")
