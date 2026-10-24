from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.floor_plan import FloorPlan
from app.models.workspace import Workspace
from app.schemas.floor_plan import FloorPlanCreate, FloorPlanRead, FloorPlanUpdate
from app.schemas.scene import upgrade_scene
from app.schemas.workspace import WorkspaceCreate, WorkspaceRead


def list_floor_plans(db: Session) -> list[FloorPlan]:
    return list(db.execute(select(FloorPlan).order_by(FloorPlan.updated_at.desc())).scalars())


def get_floor_plan(db: Session, floor_plan_id: int) -> FloorPlan | None:
    return db.get(FloorPlan, floor_plan_id)


def to_read(floor_plan: FloorPlan) -> FloorPlanRead:
    return FloorPlanRead(
        id=floor_plan.id,
        name=floor_plan.name,
        width_cm=floor_plan.width_cm,
        height_cm=floor_plan.height_cm,
        background_image_url=floor_plan.background_image_url,
        created_at=floor_plan.created_at,
        updated_at=floor_plan.updated_at,
        scene=upgrade_scene(floor_plan.scene, floor_plan.scene_version),
        workspaces=[WorkspaceRead.model_validate(workspace) for workspace in floor_plan.workspaces],
    )


def _apply_workspace(workspace: Workspace, data: WorkspaceCreate) -> Workspace:
    for field, value in data.model_dump().items():
        setattr(workspace, field, value)
    return workspace


def create_floor_plan(db: Session, data: FloorPlanCreate) -> FloorPlan:
    floor_plan = FloorPlan(
        name=data.name,
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
    floor_plan.name = data.name
    floor_plan.width_cm = data.width_cm
    floor_plan.height_cm = data.height_cm
    floor_plan.background_image_url = data.background_image_url
    floor_plan.scene = data.scene.to_document()
    floor_plan.scene_version = data.scene.version
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
