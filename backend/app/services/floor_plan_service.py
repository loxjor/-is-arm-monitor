from sqlalchemy import func, select
from sqlalchemy.orm import Session, defer

from app.models.floor_plan import FloorPlan
from app.models.organization import Building
from app.models.workspace import Workspace
from app.schemas.floor_plan import (
    FloorPlanCreate,
    FloorPlanExport,
    FloorPlanMetaUpdate,
    FloorPlanRead,
    FloorPlanSummary,
    FloorPlanUpdate,
)
from app.schemas.scene import SceneWrite, upgrade_scene
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead
from app.services.errors import ConflictError, NotFoundError


def list_floor_plans(db: Session, building_id: int | None = None) -> list[FloorPlanSummary]:
    # Списку нужна только краткая карточка (FloorPlanSummary) — документ сцены не читаем.
    query = select(FloorPlan).options(defer(FloorPlan.scene)).order_by(FloorPlan.updated_at.desc())
    if building_id is not None:
        query = query.where(FloorPlan.building_id == building_id)
    plans = list(db.execute(query).scalars())
    counts = dict(
        db.execute(
            select(Workspace.floor_plan_id, func.count()).group_by(Workspace.floor_plan_id)
        ).all()
    )
    return [
        FloorPlanSummary.model_validate(plan).model_copy(
            update={"name": plan_name(plan), "workspace_count": counts.get(plan.id, 0)}
        )
        for plan in plans
    ]


def plan_name(floor_plan: FloorPlan) -> str:
    """Схема территории называется как территория; своё name — у схемы без неё."""
    return floor_plan.building.name if floor_plan.building else floor_plan.name


def _territory_for(db: Session, building_id: int | None, plan_id: int | None = None) -> Building | None:
    """Здание для схемы: должно существовать, и другой схемы у него быть не должно."""
    if building_id is None:
        return None
    building = db.get(Building, building_id)
    if building is None:
        raise NotFoundError("территория не найдена")
    taken = select(FloorPlan.id).where(FloorPlan.building_id == building_id)
    if plan_id is not None:
        taken = taken.where(FloorPlan.id != plan_id)
    if db.scalar(taken) is not None:
        raise ConflictError("у этой территории уже есть схема")
    return building


def get_floor_plan(db: Session, floor_plan_id: int) -> FloorPlan | None:
    return db.get(FloorPlan, floor_plan_id)


def to_read(floor_plan: FloorPlan) -> FloorPlanRead:
    scene = upgrade_scene(floor_plan.scene, floor_plan.scene_version)
    # Места без этажа (сохранены до этажей) — на первом этаже плана.
    first_floor_id = scene.floors[0].id if scene.floors else None
    workspaces = [WorkspaceRead.model_validate(workspace) for workspace in floor_plan.workspaces]
    return FloorPlanRead(
        id=floor_plan.id,
        name=plan_name(floor_plan),
        building_id=floor_plan.building_id,
        description=floor_plan.description,
        width_cm=floor_plan.width_cm,
        height_cm=floor_plan.height_cm,
        background_image_url=floor_plan.background_image_url,
        created_at=floor_plan.created_at,
        updated_at=floor_plan.updated_at,
        scene=scene,
        workspaces=[
            workspace if workspace.floor_id else workspace.model_copy(update={"floor_id": first_floor_id})
            for workspace in workspaces
        ],
    )


def _apply_workspace(workspace: Workspace, data: WorkspaceCreate) -> Workspace:
    for field, value in data.model_dump().items():
        setattr(workspace, field, value)
    return workspace


def create_floor_plan(db: Session, data: FloorPlanCreate) -> FloorPlan:
    building = _territory_for(db, data.building_id)
    floor_plan = FloorPlan(
        name=building.name if building else data.name.strip(),
        building=building,
        description=data.description,
        width_cm=data.width_cm,
        height_cm=data.height_cm,
        background_image_url=data.background_image_url,
        scene=data.scene.to_document(),
        scene_version=data.scene.version,
        workspaces=[_apply_workspace(Workspace(), workspace) for workspace in data.workspaces],
    )
    db.add(floor_plan)
    db.commit()
    db.refresh(floor_plan)
    return floor_plan


def replace_floor_plan(db: Session, floor_plan: FloorPlan, data: FloorPlanUpdate) -> FloorPlan:
    """
    Сцена перезаписывается целиком, а рабочие места сверяются по client_id:
    существующие обновляются на месте (id строки не меняется), новые
    добавляются, пропавшие удаляются через delete-orphan.
    """
    if "building_id" in data.model_fields_set:
        floor_plan.building = _territory_for(db, data.building_id, floor_plan.id)
    # Редактор шлёт и название — у схемы территории оно всё равно её имя.
    if floor_plan.building:
        floor_plan.name = floor_plan.building.name
    elif data.name and data.name.strip():
        floor_plan.name = data.name.strip()
    floor_plan.width_cm = data.width_cm
    floor_plan.height_cm = data.height_cm
    floor_plan.background_image_url = data.background_image_url
    floor_plan.scene = data.scene.to_document()
    floor_plan.scene_version = data.scene.version
    if "description" in data.model_fields_set:
        floor_plan.description = data.description
    # onupdate сработает, только если ORM сочтёт строку плана изменённой; при
    # правке одних рабочих мест её может и не быть — ставим явно.
    floor_plan.updated_at = func.now()

    existing = {workspace.client_id: workspace for workspace in floor_plan.workspaces}
    floor_plan.workspaces = [
        _apply_workspace(existing.get(workspace.client_id) or Workspace(), workspace)
        for workspace in data.workspaces
    ]
    db.commit()
    db.refresh(floor_plan)
    return floor_plan


def update_floor_plan_meta(db: Session, floor_plan: FloorPlan, data: FloorPlanMetaUpdate) -> FloorPlan:
    """Меняет только переданные поля: территорию можно снять, передав null."""
    changes = data.model_dump(exclude_unset=True)
    if "building_id" in changes:
        floor_plan.building = _territory_for(db, changes["building_id"], floor_plan.id)
    if "description" in changes:
        floor_plan.description = changes["description"]
    # Название меняется только у схемы без территории; у схемы территории
    # остаётся имя здания — оно же сохранится, если схему от здания отвязать.
    if floor_plan.building:
        floor_plan.name = floor_plan.building.name
    elif changes.get("name"):
        floor_plan.name = changes["name"].strip()
    db.commit()
    db.refresh(floor_plan)
    return floor_plan


def delete_floor_plan(db: Session, floor_plan: FloorPlan) -> None:
    # Рабочие места уходят вместе с планом (delete-orphan, ON DELETE CASCADE).
    db.delete(floor_plan)
    db.commit()


def to_export(floor_plan: FloorPlan) -> FloorPlanExport:
    """Файл схемы для выгрузки: полная геометрия и места, без серверных ссылок."""
    read = to_read(floor_plan)
    return FloorPlanExport(
        name=read.name,
        width_cm=read.width_cm,
        height_cm=read.height_cm,
        background_image_url=read.background_image_url,
        description=read.description,
        scene=SceneWrite(version=read.scene.version, floors=read.scene.floors),
        workspaces=[
            WorkspaceCreate.model_validate(workspace.model_dump(exclude={"id"}))
            for workspace in read.workspaces
        ],
    )


def import_floor_plan(db: Session, data: FloorPlanExport) -> FloorPlan:
    """Импортирует схему как отдельную (без территории), сохранив её имя."""
    return create_floor_plan(
        db,
        FloorPlanCreate(
            name=data.name,
            width_cm=data.width_cm,
            height_cm=data.height_cm,
            background_image_url=data.background_image_url,
            description=data.description,
            scene=data.scene,
            workspaces=data.workspaces,
        ),
    )
