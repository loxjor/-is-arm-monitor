from collections.abc import Callable
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.config import settings
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser
from app.schemas.territory import GeocodeResult, MapConfig, TerritoryCreate, TerritoryRead, TerritoryUpdate
from app.services import geocoder, territory_service

router = APIRouter(tags=["territories"])

# Смотреть территории может любой вошедший (экран «Карта»), ставить на карту
# и править — тот же, кто правит схемы.
_editor = require(Permission.edit_floor_plans)

NOT_FOUND = {status.HTTP_404_NOT_FOUND: {"description": "Территория не найдена"}}

T = TypeVar("T")


@router.get("/map/config", response_model=MapConfig)
def map_config(_: AppUser = Depends(get_current_user)):
    return MapConfig(
        tile_url=settings.MAP_TILE_URL,
        attribution=settings.MAP_TILE_ATTRIBUTION,
        max_zoom=settings.MAP_MAX_ZOOM,
        bounds=settings.MAP_BOUNDS,
        center=(settings.MAP_CENTER_LAT, settings.MAP_CENTER_LON),
        zoom=settings.MAP_DEFAULT_ZOOM,
        geocoder=geocoder.enabled(),
    )


@router.get("/territories", response_model=list[TerritoryRead])
def list_territories(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return territory_service.list_territories(db)


def _check_region(data: TerritoryCreate | TerritoryUpdate) -> None:
    # Карта ограничена регионом (MAP_BOUNDS) — территории за его пределами не ставим.
    if data.latitude is not None and data.longitude is not None and not geocoder.in_bounds(data.latitude, data.longitude):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[{"loc": ["body", "latitude"], "msg": "точка за пределами региона карты", "type": "value_error"}],
        )


@router.post("/territories", response_model=TerritoryRead, status_code=status.HTTP_201_CREATED)
def create_territory(data: TerritoryCreate, db: Session = Depends(get_db), _: AppUser = Depends(_editor)):
    _check_region(data)
    return territory_service.create_territory(db, data)


@router.patch("/territories/{building_id}", response_model=TerritoryRead, responses=NOT_FOUND)
def update_territory(
    building_id: int,
    data: TerritoryUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(_editor),
):
    building = territory_service.get_territory(db, building_id)
    if building is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Территория не найдена")
    _check_region(data)
    return territory_service.update_territory(db, building, data)


def _geocode(call: Callable[[], T]) -> T:
    if not geocoder.enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Поиск адреса не настроен")
    try:
        return call()
    except geocoder.GeocoderUnavailable as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Геокодер недоступен") from error


@router.get("/geocode/search", response_model=list[GeocodeResult])
def geocode_search(q: str = Query(min_length=3, max_length=255), _: AppUser = Depends(_editor)):
    return _geocode(lambda: geocoder.search(q))


@router.get("/geocode/reverse", response_model=GeocodeResult | None)
def geocode_reverse(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    _: AppUser = Depends(_editor),
):
    return _geocode(lambda: geocoder.reverse(lat, lon))
