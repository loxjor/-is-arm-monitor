from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.wall_node import WallNodeCreate, WallNodeRead
from app.schemas.wall_segment import WallSegmentCreate, WallSegmentRead
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead


class FloorPlanBase(BaseModel):
    name: str = Field(max_length=255, description="Название плана")
    width_cm: float = Field(description="Ширина сцены плана, см")
    height_cm: float = Field(description="Высота сцены плана, см")
    background_image_url: str | None = Field(
        default=None, max_length=2048, description="URL фонового изображения плана"
    )


class FloorPlanCreate(FloorPlanBase):
    nodes: list[WallNodeCreate] = Field(default_factory=list)
    segments: list[WallSegmentCreate] = Field(default_factory=list)
    workspaces: list[WorkspaceCreate] = Field(default_factory=list)


class FloorPlanUpdate(FloorPlanCreate):
    """
    Тот же формат, что Create: PUT заменяет содержимое плана целиком
    (стены и рабочие места пересоздаются из присланных массивов) — для
    чертежа это надёжнее поштучных CRUD-операций и снимает вопрос
    синхронизации между клиентом и сервером.
    """


class FloorPlanRead(FloorPlanBase):
    id: int
    created_at: datetime
    updated_at: datetime
    nodes: list[WallNodeRead]
    segments: list[WallSegmentRead]
    workspaces: list[WorkspaceRead]

    model_config = ConfigDict(from_attributes=True)


class FloorPlanSummary(FloorPlanBase):
    """Краткая карточка плана для списка — без вложенных стен/рабочих мест."""

    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
