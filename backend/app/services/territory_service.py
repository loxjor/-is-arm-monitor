from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.floor_plan import FloorPlan
from app.models.organization import Building
from app.models.workspace import Workspace
from app.schemas.territory import TerritoryCreate, TerritoryPlan, TerritoryRead, TerritoryUpdate


def list_territories(db: Session, building_id: int | None = None) -> list[TerritoryRead]:
    """Здания с их схемой — и те, что ещё не поставлены на карту (их ставят в редакторе схем)."""
    buildings_query = select(Building).order_by(Building.name)
    plans_query = (
        select(FloorPlan.id, FloorPlan.description, FloorPlan.updated_at, FloorPlan.building_id)
        .where(FloorPlan.building_id.is_not(None))
    )
    if building_id is not None:
        buildings_query = buildings_query.where(Building.building_id == building_id)
        plans_query = plans_query.where(FloorPlan.building_id == building_id)

    counts = dict(
        db.execute(select(Workspace.floor_plan_id, func.count()).group_by(Workspace.floor_plan_id)).all()
    )
    plans = {
        plan_building_id: TerritoryPlan(
            id=plan_id,
            description=description,
            workspace_count=counts.get(plan_id, 0),
            updated_at=updated_at,
        )
        for plan_id, description, updated_at, plan_building_id in db.execute(plans_query).tuples()
    }
    return [
        TerritoryRead(
            building_id=building.building_id,
            name=building.name,
            address=building.address,
            floors_count=building.floors_count,
            latitude=building.latitude,
            longitude=building.longitude,
            plan=plans.get(building.building_id),
        )
        for building in db.scalars(buildings_query)
    ]


def get_territory(db: Session, building_id: int) -> Building | None:
    return db.get(Building, building_id)


def create_territory(db: Session, data: TerritoryCreate) -> TerritoryRead:
    building = Building(**data.model_dump())
    db.add(building)
    db.commit()
    return list_territories(db, building.building_id)[0]


def update_territory(db: Session, building: Building, data: TerritoryUpdate) -> TerritoryRead:
    changes = data.model_dump(exclude_unset=True)
    # Название и адрес у здания обязательны: null в PATCH для них — «не менять».
    for field in ("name", "address"):
        if changes.get(field, "") is None:
            changes.pop(field)
    for field, value in changes.items():
        setattr(building, field, value)
    if "name" in changes:
        # Схема называется как территория — храним то же имя на случай, если её отвяжут.
        db.execute(update(FloorPlan).where(FloorPlan.building_id == building.building_id).values(name=changes["name"]))
    db.commit()
    return list_territories(db, building.building_id)[0]
