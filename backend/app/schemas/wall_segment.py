from pydantic import BaseModel, ConfigDict, Field


class WallSegmentBase(BaseModel):
    thickness: float = Field(gt=0, description="Толщина стены, см")


class WallSegmentCreate(WallSegmentBase):
    # См. WallNodeCreate.client_id — здесь то же самое: ссылка на узел по
    # его временному id в пределах текущего запроса, а не по id БД.
    start_client_id: str = Field(description="client_id узла начала (см. WallNodeCreate)")
    end_client_id: str = Field(description="client_id узла конца (см. WallNodeCreate)")


class WallSegmentRead(WallSegmentBase):
    id: int
    start_node_id: int
    end_node_id: int

    model_config = ConfigDict(from_attributes=True)
