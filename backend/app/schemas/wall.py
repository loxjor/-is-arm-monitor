from pydantic import BaseModel, ConfigDict, Field


class WallBase(BaseModel):
    x: float = Field(description="Точка начала стены (X), см")
    y: float = Field(description="Точка начала стены (Y), см")
    length: float = Field(gt=0, description="Длина стены вдоль направления rotation, см")
    thickness: float = Field(gt=0, description="Толщина стены, см")
    rotation: float = Field(ge=-360, le=360, description="Угол направления стены, градусы")


class WallCreate(WallBase):
    pass


class WallRead(WallBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
