from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.floor_plan import FloorPlan
from app.models.wall import Wall
from app.models.workspace import Workspace
from app.schemas.floor_plan import FloorPlanCreate, FloorPlanUpdate


def list_floor_plans(db: Session) -> list[FloorPlan]:
    return list(db.execute(select(FloorPlan).order_by(FloorPlan.updated_at.desc())).scalars())


def get_floor_plan(db: Session, floor_plan_id: int) -> FloorPlan | None:
    return db.get(FloorPlan, floor_plan_id)


def create_floor_plan(db: Session, data: FloorPlanCreate) -> FloorPlan:
    floor_plan = FloorPlan(
        name=data.name,
        width_cm=data.width_cm,
        height_cm=data.height_cm,
        background_image_url=data.background_image_url,
        walls=[Wall(**wall.model_dump()) for wall in data.walls],
        workspaces=[Workspace(**workspace.model_dump()) for workspace in data.workspaces],
    )
    db.add(floor_plan)
    db.commit()
    db.refresh(floor_plan)
    return floor_plan


def replace_floor_plan(db: Session, floor_plan: FloorPlan, data: FloorPlanUpdate) -> FloorPlan:
    """
    Заменяет содержимое плана целиком: поля плана обновляются на месте, а
    стены/рабочие места — удаляются и создаются заново из присланных
    массивов. cascade="all, delete-orphan" на relationship в FloorPlan
    удаляет старые строки при переприсвоении коллекции.
    """
    floor_plan.name = data.name
    floor_plan.width_cm = data.width_cm
    floor_plan.height_cm = data.height_cm
    floor_plan.background_image_url = data.background_image_url
    floor_plan.walls = [Wall(**wall.model_dump()) for wall in data.walls]
    floor_plan.workspaces = [Workspace(**workspace.model_dump()) for workspace in data.workspaces]
    db.commit()
    db.refresh(floor_plan)
    return floor_plan
