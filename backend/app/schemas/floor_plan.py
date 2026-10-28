from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.scene import PositiveSize, SceneRead, SceneWrite
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead

MAX_WORKSPACES = 2000


class FloorPlanBase(BaseModel):
    name: str = Field(max_length=255, description="Название плана")
    width_cm: PositiveSize = Field(description="Ширина сцены плана, см")
    height_cm: PositiveSize = Field(description="Высота сцены плана, см")
    background_image_url: str | None = Field(
        default=None, max_length=2048, description="URL фонового изображения плана"
    )


class FloorPlanCreate(FloorPlanBase):
    scene: SceneWrite
    workspaces: list[WorkspaceCreate] = Field(default_factory=list, max_length=MAX_WORKSPACES)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def check_workspaces(self) -> "FloorPlanCreate":
        seen: set[str] = set()
        floor_ids = set(self.scene.floor_ids())
        for workspace in self.workspaces:
            if workspace.client_id in seen:
                raise ValueError(f"повторяющийся client_id рабочего места: {workspace.client_id!r}")
            seen.add(workspace.client_id)
            if workspace.floor_id is not None and workspace.floor_id not in floor_ids:
                raise ValueError(f"рабочее место {workspace.client_id!r} на неизвестном этаже")
        return self


class FloorPlanUpdate(FloorPlanCreate):
    """
    Тот же формат, что Create: PUT заменяет план целиком. Сцена (стены,
    проёмы) перезаписывается документом, рабочие места сверяются по
    client_id — существующие обновляются на месте, отсутствующие удаляются.
    """


class FloorPlanRead(FloorPlanBase):
    id: int
    created_at: datetime
    updated_at: datetime
    scene: SceneRead
    workspaces: list[WorkspaceRead]


class FloorPlanSummary(FloorPlanBase):
    """Краткая карточка плана для списка — без сцены и рабочих мест."""

    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
