from pydantic import BaseModel, ConfigDict, Field

from app.models.workspace import WorkspaceStatus


class WorkspaceBase(BaseModel):
    x: float = Field(description="X, см")
    y: float = Field(description="Y, см")
    width: float = Field(gt=0, description="Ширина, см")
    height: float = Field(gt=0, description="Высота, см")
    rotation: float = Field(ge=-360, le=360, description="Угол поворота, градусы")
    label: str = Field(max_length=255, description="Подпись рабочего места")
    status: WorkspaceStatus = Field(description="Статус: free / occupied / reserved")


class WorkspaceCreate(WorkspaceBase):
    pass


class WorkspaceRead(WorkspaceBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
