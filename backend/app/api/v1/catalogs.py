"""Маршруты справочников. Читать — роли с правом view_catalogs (все, кроме
рядового сотрудника), изменять — только с правом manage_catalogs.

Без `from __future__ import annotations`: FastAPI читает аннотации тел
запросов в момент создания маршрута, а они берутся из локальной переменной фабрики.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import (
    AppUser,
    Building,
    Department,
    Employee,
    EquipmentModel,
    EquipmentType,
    Manufacturer,
    OperatingSystem,
    Room,
    Workplace,
)
from app.schemas import catalog as s
from app.schemas.page import Page
from app.services import catalog_service
from app.services.catalog_service import CatalogSpec
from app.services.errors import ConflictError, NotFoundError

CATALOGS: list[CatalogSpec] = [
    CatalogSpec(
        "departments", "Подразделение", Department, s.DepartmentCreate, s.DepartmentRead,
        search_fields=("name", "short_name"), filter_fields=("parent_dept_id",),
        validate=catalog_service.validate_department,
    ),
    CatalogSpec(
        "employees", "Сотрудник", Employee, s.EmployeeCreate, s.EmployeeRead,
        search_fields=("full_name", "position", "email"), filter_fields=("dept_id",), order_by="full_name",
    ),
    CatalogSpec("buildings", "Здание", Building, s.BuildingCreate, s.BuildingRead, search_fields=("name", "address")),
    CatalogSpec(
        "rooms", "Помещение", Room, s.RoomCreate, s.RoomRead,
        search_fields=("room_no",), filter_fields=("building_id", "dept_id"), order_by="room_no",
    ),
    CatalogSpec(
        "workplaces", "Рабочее место", Workplace, s.WorkplaceCreate, s.WorkplaceRead,
        search_fields=("workplace_no",), filter_fields=("room_id",), order_by="workplace_no",
    ),
    CatalogSpec(
        "equipment-types", "Тип оборудования", EquipmentType, s.EquipmentTypeCreate, s.EquipmentTypeRead,
        search_fields=("name",),
    ),
    CatalogSpec(
        "manufacturers", "Производитель", Manufacturer, s.ManufacturerCreate, s.ManufacturerRead,
        search_fields=("name", "country"),
    ),
    CatalogSpec(
        "equipment-models", "Модель оборудования", EquipmentModel, s.EquipmentModelCreate, s.EquipmentModelRead,
        search_fields=("name", "specs"), filter_fields=("type_id", "manufacturer_id"),
    ),
    CatalogSpec(
        "operating-systems", "Операционная система", OperatingSystem, s.OperatingSystemCreate,
        s.OperatingSystemRead, search_fields=("name", "version"),
    ),
]


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, ConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


def _make_router(spec: CatalogSpec) -> APIRouter:
    router = APIRouter(prefix=f"/{spec.path}", tags=["catalogs"])
    Create = spec.create_schema
    Read = spec.read_schema
    editor = require(Permission.manage_catalogs)
    reader = require(Permission.view_catalogs)

    @router.get("", response_model=Page[Read], name=f"list_{spec.path}")
    def list_records(
        request: Request,
        q: str | None = Query(default=None, max_length=100, description="Поиск по текстовым полям"),
        limit: int = Query(default=50, ge=1, le=1000),
        offset: int = Query(default=0, ge=0),
        db: Session = Depends(get_db),
        _: AppUser = Depends(reader),
    ):
        # Фильтры по внешним ключам (?dept_id=3) — из перечня spec.filter_fields.
        filters: dict[str, int] = {}
        for name in spec.filter_fields:
            raw = request.query_params.get(name)
            if raw is not None:
                if not raw.isdigit():
                    raise HTTPException(status_code=422, detail=f"{name}: ожидается целое число")
                filters[name] = int(raw)
        items, total = catalog_service.list_records(db, spec, q=q, filters=filters, limit=limit, offset=offset)
        return {"items": items, "total": total}

    @router.get("/{pk}", response_model=Read, name=f"get_{spec.path}")
    def get_record(pk: int, db: Session = Depends(get_db), _: AppUser = Depends(reader)):
        try:
            return catalog_service.get_record(db, spec, pk)
        except NotFoundError as error:
            raise _http_error(error)

    @router.post("", response_model=Read, status_code=status.HTTP_201_CREATED, name=f"create_{spec.path}")
    def create_record(data: Create, db: Session = Depends(get_db), actor: AppUser = Depends(editor)):  # type: ignore[valid-type]
        try:
            return catalog_service.create_record(db, spec, data, actor_id=actor.user_id)
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
        except ConflictError as error:
            raise _http_error(error)

    @router.put("/{pk}", response_model=Read, name=f"update_{spec.path}")
    def update_record(pk: int, data: Create, db: Session = Depends(get_db), actor: AppUser = Depends(editor)):  # type: ignore[valid-type]
        try:
            catalog_service.get_record(db, spec, pk)
        except NotFoundError as error:
            raise _http_error(error)
        try:
            return catalog_service.update_record(db, spec, pk, data, actor_id=actor.user_id)
        except NotFoundError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
        except ConflictError as error:
            raise _http_error(error)

    @router.delete("/{pk}", status_code=status.HTTP_204_NO_CONTENT, name=f"delete_{spec.path}")
    def delete_record(pk: int, db: Session = Depends(get_db), actor: AppUser = Depends(editor)):
        try:
            catalog_service.delete_record(db, spec, pk, actor_id=actor.user_id)
        except (NotFoundError, ConflictError) as error:
            raise _http_error(error)

    return router


router = APIRouter()
for _spec in CATALOGS:
    router.include_router(_make_router(_spec))
