from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.floor_plan import FloorPlan
from app.models.wall_node import WallNode
from app.models.wall_segment import WallSegment
from app.models.workspace import Workspace
from app.schemas.floor_plan import FloorPlanCreate, FloorPlanUpdate


class InvalidWallGraphError(ValueError):
    """Сегмент ссылается на client_id узла, которого нет среди присланных узлов."""


def list_floor_plans(db: Session) -> list[FloorPlan]:
    return list(db.execute(select(FloorPlan).order_by(FloorPlan.updated_at.desc())).scalars())


def get_floor_plan(db: Session, floor_plan_id: int) -> FloorPlan | None:
    return db.get(FloorPlan, floor_plan_id)


def _build_nodes_and_segments(
    data: FloorPlanCreate | FloorPlanUpdate,
) -> tuple[list[WallNode], list[WallSegment]]:
    """
    Узлы и сегменты приходят одним запросом и ссылаются друг на друга по
    временным client_id (см. WallNodeCreate/WallSegmentCreate) — у БД ещё
    нет их id на момент запроса. Собираем ORM-объекты и связываем сегменты
    с узлами через relationship (start_node/end_node), а не через голые
    *_node_id: SQLAlchemy сам проставит настоящие id при commit, ручной
    flush между вставкой узлов и сегментов не нужен.
    """
    nodes_by_client_id: dict[str, WallNode] = {}
    nodes: list[WallNode] = []
    for node_data in data.nodes:
        node = WallNode(x=node_data.x, y=node_data.y)
        nodes_by_client_id[node_data.client_id] = node
        nodes.append(node)

    segments: list[WallSegment] = []
    for segment_data in data.segments:
        start_node = nodes_by_client_id.get(segment_data.start_client_id)
        end_node = nodes_by_client_id.get(segment_data.end_client_id)
        if start_node is None or end_node is None:
            raise InvalidWallGraphError(
                f"Сегмент ссылается на неизвестный client_id узла: "
                f"{segment_data.start_client_id!r} / {segment_data.end_client_id!r}"
            )
        segments.append(
            WallSegment(start_node=start_node, end_node=end_node, thickness=segment_data.thickness)
        )

    return nodes, segments


def create_floor_plan(db: Session, data: FloorPlanCreate) -> FloorPlan:
    nodes, segments = _build_nodes_and_segments(data)
    floor_plan = FloorPlan(
        name=data.name,
        width_cm=data.width_cm,
        height_cm=data.height_cm,
        background_image_url=data.background_image_url,
        nodes=nodes,
        segments=segments,
        workspaces=[Workspace(**workspace.model_dump()) for workspace in data.workspaces],
    )
    db.add(floor_plan)
    db.commit()
    db.refresh(floor_plan)
    return floor_plan


def replace_floor_plan(db: Session, floor_plan: FloorPlan, data: FloorPlanUpdate) -> FloorPlan:
    """
    Заменяет содержимое плана целиком: поля плана обновляются на месте, а
    узлы/сегменты/рабочие места — удаляются и создаются заново из присланных
    массивов. cascade="all, delete-orphan" на relationship в FloorPlan
    удаляет старые строки при переприсвоении коллекции.
    """
    nodes, segments = _build_nodes_and_segments(data)
    floor_plan.name = data.name
    floor_plan.width_cm = data.width_cm
    floor_plan.height_cm = data.height_cm
    floor_plan.background_image_url = data.background_image_url
    floor_plan.nodes = nodes
    floor_plan.segments = segments
    floor_plan.workspaces = [Workspace(**workspace.model_dump()) for workspace in data.workspaces]
    db.commit()
    db.refresh(floor_plan)
    return floor_plan
