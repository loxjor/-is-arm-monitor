from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]

_PAIR = "координаты задаются парой: широта и долгота"


class TerritoryPlan(BaseModel):
    """Схема территории (называется так же, как территория) — без геометрии."""

    id: int
    description: str | None
    workspace_count: int
    updated_at: datetime


class TerritoryCreate(BaseModel):
    """Территория — здание из справочника с точкой на доме на карте."""

    name: str = Field(min_length=1, max_length=50)
    address: str = Field(min_length=1, max_length=255)
    floors_count: int | None = Field(default=None, ge=0, le=32767)
    latitude: Latitude | None = None
    longitude: Longitude | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def check_point(self) -> "TerritoryCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError(_PAIR)
        return self


class TerritoryUpdate(BaseModel):
    """PATCH: меняются только переданные поля; точку снимают, передав обе координаты null."""

    name: str | None = Field(default=None, min_length=1, max_length=50)
    address: str | None = Field(default=None, min_length=1, max_length=255)
    floors_count: int | None = Field(default=None, ge=0, le=32767)
    latitude: Latitude | None = None
    longitude: Longitude | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def check_point(self) -> "TerritoryUpdate":
        given = {"latitude", "longitude"} & self.model_fields_set
        if len(given) == 1 or (given and (self.latitude is None) != (self.longitude is None)):
            raise ValueError(_PAIR)
        return self


class TerritoryRead(BaseModel):
    building_id: int
    name: str
    address: str
    floors_count: int | None
    latitude: float | None
    longitude: float | None
    # У территории одна схема, этажи — внутри неё; None — схему ещё не создали.
    plan: TerritoryPlan | None


class MapConfig(BaseModel):
    """Откуда фронтенду брать тайлы и есть ли поиск адреса — задаётся в .env."""

    tile_url: str
    attribution: str
    max_zoom: int
    # Запад, юг, восток, север (WGS 84) — за пределы карта не выходит.
    bounds: tuple[float, float, float, float]
    center: tuple[float, float]
    zoom: int
    geocoder: bool


class GeocodeResult(BaseModel):
    address: str
    latitude: float
    longitude: float
