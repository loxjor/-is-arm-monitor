from pydantic import BaseModel, ConfigDict, Field


class WallNodeBase(BaseModel):
    x: float = Field(description="X, см")
    y: float = Field(description="Y, см")


class WallNodeCreate(WallNodeBase):
    # Узлы и сегменты создаются одним запросом (PUT/POST всего плана), и до
    # commit у узла ещё нет id БД, на который мог бы сослаться сегмент.
    # client_id — временный идентификатор в пределах ОДНОГО запроса: клиент
    # передаёт сюда свой локальный id узла, а WallSegmentCreate ссылается на
    # него в start_client_id/end_client_id (см. floor_plan_service).
    client_id: str = Field(description="Временный id узла в пределах запроса — связывает его с сегментами")


class WallNodeRead(WallNodeBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
