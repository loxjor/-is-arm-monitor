from __future__ import annotations

from sqlalchemy import Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class WallSegment(Base):
    """Ребро графа стен — сегмент между двумя узлами. thickness — см, одинакова по всей длине."""

    __tablename__ = "wall_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_plan_id: Mapped[int] = mapped_column(
        ForeignKey("floor_plans.id", ondelete="CASCADE"), index=True
    )
    start_node_id: Mapped[int] = mapped_column(ForeignKey("wall_nodes.id", ondelete="CASCADE"))
    end_node_id: Mapped[int] = mapped_column(ForeignKey("wall_nodes.id", ondelete="CASCADE"))
    thickness: Mapped[float] = mapped_column(Float)

    floor_plan: Mapped["FloorPlan"] = relationship(back_populates="segments")
    # Два FK на одну и ту же таблицу — foreign_keys обязателен, иначе
    # SQLAlchemy не может сам решить, какая колонка какому relationship
    # соответствует.
    start_node: Mapped["WallNode"] = relationship(foreign_keys=[start_node_id])
    end_node: Mapped["WallNode"] = relationship(foreign_keys=[end_node_id])
