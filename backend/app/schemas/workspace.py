from pydantic import BaseModel, ConfigDict, Field

from app.models.workspace import WorkspaceStatus


class WorkspaceBase(BaseModel):
    x: float = Field(description="X, см")
    y: float = Field(description="Y, см")
    width: float = Field(description="Ширина, см")
    height: float = Field(description="Высота, см")
    rotation: float = Field(description="Угол поворота, градусы")
    label: str = Field(description="Подпись рабочего места")
    status: WorkspaceStatus = Field(description="Статус: free / occupied / reserved")


class WorkspaceCreate(WorkspaceBase):
    pass


class WorkspaceRead(WorkspaceBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
