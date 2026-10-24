import math
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.workspace import WorkspaceStatus
from app.schemas.scene import ClientId, Coordinate, PositiveSize


class WorkspaceBase(BaseModel):
    client_id: ClientId = Field(description="id места на фронтенде, постоянный между сохранениями")
    x: Coordinate = Field(description="X, см")
    y: Coordinate = Field(description="Y, см")
    width: PositiveSize = Field(description="Ширина, см")
    height: PositiveSize = Field(description="Высота, см")
    rotation: Annotated[float, Field(allow_inf_nan=False)] = Field(
        description="Угол поворота, градусы; приводится к (-360, 360)"
    )
    label: str = Field(max_length=255, description="Подпись рабочего места")
    status: WorkspaceStatus = Field(description="Статус: free / occupied / reserved")

    @field_validator("rotation")
    @classmethod
    def normalize_rotation(cls, value: float) -> float:
        # Konva Transformer после нескольких оборотов отдаёт 450, -540 и т.п. —
        # это тот же угол, отклонять его нельзя.
        return math.fmod(value, 360.0)


class WorkspaceCreate(WorkspaceBase):
    model_config = ConfigDict(extra="forbid")


class WorkspaceRead(WorkspaceBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
