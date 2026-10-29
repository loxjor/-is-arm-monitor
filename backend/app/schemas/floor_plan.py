from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.schemas.scene import PositiveSize, SceneRead, SceneWrite
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead

MAX_WORKSPACES = 2000


def _blank_to_none(value: object) -> object:
    # Пустое описание из формы — «не задано», а не строка из пробелов.
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


Description = Annotated[Annotated[str, Field(max_length=2000)] | None, BeforeValidator(_blank_to_none)]


class FloorPlanBase(BaseModel):
    name: str = Field(max_length=255, description="Название плана")
    width_cm: PositiveSize = Field(description="Ширина сцены плана, см")
    height_cm: PositiveSize = Field(description="Высота сцены плана, см")
    background_image_url: str | None = Field(
        default=None, max_length=2048, description="URL фонового изображения плана"
    )


def _validate_workspaces(scene: SceneWrite, workspaces: list[WorkspaceCreate]) -> None:
    """Рабочие места: уникальные client_id и ссылки только на известные этажи."""
    seen: set[str] = set()
    floor_ids = set(scene.floor_ids())
    for workspace in workspaces:
        if workspace.client_id in seen:
            raise ValueError(f"повторяющийся client_id рабочего места: {workspace.client_id!r}")
        seen.add(workspace.client_id)
        if workspace.floor_id is not None and workspace.floor_id not in floor_ids:
            raise ValueError(f"рабочее место {workspace.client_id!r} на неизвестном этаже")


class FloorPlanCreate(FloorPlanBase):
    # Схема территории называется как территория — своё название нужно только
    # схеме без территории (сервер подставит имя здания, если оно задано).
    name: str | None = Field(default=None, max_length=255, description="Название схемы без территории")
    scene: SceneWrite
    building_id: int | None = Field(default=None, description="Территория (здание), к которой относится схема")
    description: Description = Field(default=None, description="Описание схемы")
    workspaces: list[WorkspaceCreate] = Field(default_factory=list, max_length=MAX_WORKSPACES)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def check_workspaces(self) -> "FloorPlanCreate":
        if self.building_id is None and not (self.name and self.name.strip()):
            raise ValueError("у схемы без территории должно быть название")
        _validate_workspaces(self.scene, self.workspaces)
        return self


class FloorPlanUpdate(FloorPlanCreate):
    """
    Тот же формат, что Create: PUT заменяет план целиком. Сцена (стены,
    проёмы) перезаписывается документом, рабочие места сверяются по
    client_id — существующие обновляются на месте, отсутствующие удаляются.
    Территория и описание меняются, только если переданы: редактор их не шлёт.
    """


class FloorPlanMetaUpdate(BaseModel):
    """PATCH из «Редактора схем»: территория, описание (и название схемы без территории) — без геометрии."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    building_id: int | None = None
    description: Description = None

    model_config = ConfigDict(extra="forbid")


class FloorPlanRead(FloorPlanBase):
    id: int
    building_id: int | None
    description: str | None
    created_at: datetime
    updated_at: datetime
    scene: SceneRead
    workspaces: list[WorkspaceRead]


class FloorPlanExport(BaseModel):
    """
    Самодостаточный файл схемы (JSON) для переноса между серверами и резервной
    копии: геометрия, рабочие места и описание без серверных ссылок (id строк,
    территория). Импортируется как схема без территории с сохранением имени.
    """

    format: Literal["arm-monitor-floor-plan"] = "arm-monitor-floor-plan"
    format_version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=255, description="Название схемы")
    width_cm: PositiveSize = Field(description="Ширина сцены плана, см")
    height_cm: PositiveSize = Field(description="Высота сцены плана, см")
    background_image_url: str | None = Field(
        default=None, max_length=2048, description="URL фонового изображения плана"
    )
    description: Description = Field(default=None, description="Описание схемы")
    scene: SceneWrite
    workspaces: list[WorkspaceCreate] = Field(default_factory=list, max_length=MAX_WORKSPACES)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def check_workspaces(self) -> "FloorPlanExport":
        _validate_workspaces(self.scene, self.workspaces)
        return self


class FloorPlanSummary(FloorPlanBase):
    """Краткая карточка плана для списка — без сцены и рабочих мест."""

    id: int
    building_id: int | None
    description: str | None
    workspace_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
