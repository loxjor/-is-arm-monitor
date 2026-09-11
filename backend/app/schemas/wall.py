from pydantic import BaseModel, ConfigDict, Field


class WallBase(BaseModel):
    x: float = Field(description="Точка начала стены (X), см")
    y: float = Field(description="Точка начала стены (Y), см")
    length: float = Field(description="Длина стены вдоль направления rotation, см")
    thickness: float = Field(description="Толщина стены, см")
    rotation: float = Field(description="Угол направления стены, градусы")


class WallCreate(WallBase):
    pass


class WallRead(WallBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
