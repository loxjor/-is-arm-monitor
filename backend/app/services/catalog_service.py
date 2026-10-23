"""Общий CRUD справочников (BPMN 2.4 «Ведение справочников БД»).

Справочник описывается CatalogSpec; поиск, фильтры, проверка ссылок на
родительские записи и запрет удаления используемой записи — общие для всех.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel
from sqlalchemy import ColumnElement, Table, func, inspect, or_, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models import Department
from app.services import audit_service
from app.services.errors import ConflictError, NotFoundError

# Названия таблиц для сообщений «запись используется в …».
TABLE_TITLES: dict[str, str] = {
    "department": "подразделения",
    "employee": "сотрудники",
    "building": "здания",
    "room": "помещения",
    "workplace": "рабочие места",
    "equipment_type": "типы оборудования",
    "manufacturer": "производители",
    "equipment_model": "модели оборудования",
    "operating_system": "операционные системы",
    "equipment": "оборудование",
    "assignment": "история назначений",
    "ticket": "заявки",
    "ticket_work": "работы по заявкам",
    "inventory": "инвентаризации",
    "inventory_result": "результаты инвентаризаций",
    "writeoff_act": "акты списания",
    "app_user": "пользователи ИС",
}

Validator = Callable[[Session, Any, BaseModel], None]


@dataclass(frozen=True)
class CatalogSpec:
    path: str
    title: str
    model: type[Base]
    create_schema: type[BaseModel]
    read_schema: type[BaseModel]
    search_fields: tuple[str, ...]
    filter_fields: tuple[str, ...] = ()
    order_by: str = "name"
    validate: Validator | None = field(default=None)

    @property
    def table(self) -> Table:
        return self.model.__table__  # type: ignore[return-value]

    @property
    def pk_name(self) -> str:
        return inspect(self.model).primary_key[0].name


def _model_for_table(table: Table) -> type[Base]:
    for mapper in Base.registry.mappers:
        if mapper.local_table is table:
            return mapper.class_
    raise LookupError(table.name)


def _check_parents_exist(db: Session, spec: CatalogSpec, values: Mapping[str, Any]) -> None:
    for column in spec.table.columns:
        value = values.get(column.name)
        if value is None:
            continue
        for fk in column.foreign_keys:
            parent = _model_for_table(fk.column.table)
            if db.get(parent, value) is None:
                title = TABLE_TITLES.get(fk.column.table.name, fk.column.table.name)
                raise NotFoundError(f"Не найдена связанная запись ({title}, код {value})")


def find_references(db: Session, spec: CatalogSpec, pk: int) -> dict[str, int]:
    """Сколько строк в каких таблицах ссылаются на запись — по внешним ключам схемы."""
    usage: dict[str, int] = {}
    for table in Base.metadata.tables.values():
        for fk in table.foreign_keys:
            if fk.column.table is not spec.table:
                continue
            count = db.scalar(select(func.count()).select_from(table).where(fk.parent == pk)) or 0
            if count:
                title = TABLE_TITLES.get(table.name, table.name)
                usage[title] = usage.get(title, 0) + count
    return usage


def list_records(
    db: Session,
    spec: CatalogSpec,
    *,
    q: str | None,
    filters: Mapping[str, int],
    limit: int,
    offset: int,
) -> tuple[list[Any], int]:
    query = select(spec.model)
    if q:
        pattern = f"%{q.strip()}%"
        conditions: list[ColumnElement[bool]] = [
            spec.table.c[name].ilike(pattern) for name in spec.search_fields
        ]
        query = query.where(or_(*conditions))
    for name, value in filters.items():
        if name in spec.filter_fields:
            query = query.where(spec.table.c[name] == value)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(spec.table.c[spec.order_by], spec.table.c[spec.pk_name]).limit(limit).offset(offset)
    )
    return list(items), total


def get_record(db: Session, spec: CatalogSpec, pk: int) -> Any:
    record = db.get(spec.model, pk)
    if record is None:
        raise NotFoundError(f"{spec.title}: запись не найдена")
    return record


def create_record(db: Session, spec: CatalogSpec, data: BaseModel, *, actor_id: int) -> Any:
    values = data.model_dump()
    _check_parents_exist(db, spec, values)
    record = spec.model(**values)
    if spec.validate is not None:
        spec.validate(db, record, data)
    db.add(record)
    db.flush()
    pk = getattr(record, spec.pk_name)
    audit_service.record(db, user_id=actor_id, action="create", entity=spec.table.name, entity_id=pk, details=values)
    db.commit()
    db.refresh(record)
    return record


def update_record(db: Session, spec: CatalogSpec, pk: int, data: BaseModel, *, actor_id: int) -> Any:
    record = get_record(db, spec, pk)
    values = data.model_dump()
    _check_parents_exist(db, spec, values)
    if spec.validate is not None:
        spec.validate(db, record, data)

    changes = {
        name: {"from": getattr(record, name), "to": value}
        for name, value in values.items()
        if getattr(record, name) != value
    }
    for name, value in values.items():
        setattr(record, name, value)
    if changes:
        audit_service.record(
            db, user_id=actor_id, action="update", entity=spec.table.name, entity_id=pk, details=changes
        )
    db.commit()
    db.refresh(record)
    return record


def delete_record(db: Session, spec: CatalogSpec, pk: int, *, actor_id: int) -> None:
    record = get_record(db, spec, pk)
    usage = find_references(db, spec, pk)
    if usage:
        listed = ", ".join(f"{title} — {count}" for title, count in usage.items())
        raise ConflictError(f"Запись используется: {listed}")
    db.delete(record)
    audit_service.record(db, user_id=actor_id, action="delete", entity=spec.table.name, entity_id=pk)
    db.commit()


def validate_department(db: Session, record: Department, data: BaseModel) -> None:
    parent_id = getattr(data, "parent_dept_id", None)
    if parent_id is None or record.dept_id is None:
        return
    # Поднимаемся от нового родителя к корню: встретить себя — значит цикл.
    current: int | None = parent_id
    while current is not None:
        if current == record.dept_id:
            raise ConflictError("Подразделение не может входить само в себя или в своё дочернее")
        parent = db.get(Department, current)
        current = parent.parent_dept_id if parent else None
