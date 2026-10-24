import math
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Координаты и размеры в см. NaN/Infinity json.loads пропускает как float,
# а Postgres Float их хранит — отсекаем на входе.
Coordinate = Annotated[float, Field(allow_inf_nan=False, ge=-1_000_000, le=1_000_000)]
PositiveSize = Annotated[float, Field(allow_inf_nan=False, gt=0, le=100_000)]
ClientId = Annotated[str, Field(min_length=1, max_length=64)]

CURRENT_SCENE_VERSION = 3
# Допуск на округление: проём шириной ровно в стену не должен отклоняться
# из-за 1e-12 после пересчёта координат на клиенте.
GEOMETRY_EPSILON = 1e-6

MAX_NODES = 5000
MAX_SEGMENTS = 5000
MAX_OPENINGS = 2000


class StrictModel(BaseModel):
    # Неизвестные поля — ошибка, а не тихий отброс: иначе клиент новой версии,
    # говорящий со старым сервером, терял бы данные без единого сообщения.
    model_config = ConfigDict(extra="forbid")


class SceneNode(StrictModel):
    id: ClientId
    x: Coordinate
    y: Coordinate


class SceneSegment(StrictModel):
    id: ClientId
    start_node_id: ClientId
    end_node_id: ClientId
    thickness: Annotated[float, Field(allow_inf_nan=False, gt=0, le=500)]


class OpeningKind(str, Enum):
    doorway = "doorway"
    door = "door"
    door_double = "door_double"
    windowway = "windowway"
    window = "window"


# У этих видов есть полотно — ему нужна сторона петель и сторона открывания.
KINDS_WITH_LEAF = {OpeningKind.door, OpeningKind.door_double}


class SceneOpening(StrictModel):
    """Дверь или окно в стене: центр проёма — offset см вдоль оси сегмента от его начального узла."""

    id: ClientId
    segment_id: ClientId
    kind: OpeningKind
    offset: Annotated[float, Field(allow_inf_nan=False, ge=0, le=1_000_000)]
    width: PositiveSize
    height: PositiveSize
    sill_height: Annotated[float, Field(allow_inf_nan=False, ge=0, le=100_000)]
    hinge: Literal["start", "end"] | None = None
    swing: Literal["left", "right"] | None = None

    @model_validator(mode="after")
    def leaf_needs_hinge_and_swing(self) -> "SceneOpening":
        if self.kind in KINDS_WITH_LEAF and (self.hinge is None or self.swing is None):
            raise ValueError(f"у двери {self.id!r} должны быть заданы hinge и swing")
        return self


def _require_unique_ids(items: list[Any], what: str) -> None:
    seen: set[str] = set()
    for item in items:
        if item.id in seen:
            raise ValueError(f"повторяющийся id {what}: {item.id!r}")
        seen.add(item.id)


class SceneWrite(StrictModel):
    """
    Документ геометрии плана, как его присылает клиент. version 2 — без
    проёмов (только стены), version 3 — со стенами и проёмами. Граф и проёмы
    проверяются целиком здесь, а не в сервисе: тогда ошибка — обычный 422
    FastAPI с loc, который фронтенд умеет показать.
    """

    version: Literal[2, 3]
    nodes: list[SceneNode] = Field(default_factory=list, max_length=MAX_NODES)
    segments: list[SceneSegment] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    openings: list[SceneOpening] = Field(default_factory=list, max_length=MAX_OPENINGS)

    @model_validator(mode="after")
    def check_graph(self) -> "SceneWrite":
        _require_unique_ids(self.nodes, "узла")
        _require_unique_ids(self.segments, "сегмента")
        _require_unique_ids(self.openings, "проёма")

        nodes = {node.id: node for node in self.nodes}
        lengths: dict[str, float] = {}
        pairs: set[frozenset[str]] = set()
        for segment in self.segments:
            start = nodes.get(segment.start_node_id)
            end = nodes.get(segment.end_node_id)
            if start is None or end is None:
                raise ValueError(f"сегмент {segment.id!r} ссылается на неизвестный узел")
            if segment.start_node_id == segment.end_node_id:
                raise ValueError(f"сегмент {segment.id!r} начинается и заканчивается в одном узле")
            pair = frozenset((segment.start_node_id, segment.end_node_id))
            if pair in pairs:
                raise ValueError(f"между узлами сегмента {segment.id!r} уже есть другой сегмент")
            pairs.add(pair)
            lengths[segment.id] = math.hypot(end.x - start.x, end.y - start.y)

        if self.version < 3 and self.openings:
            raise ValueError("проёмы поддерживаются только в сцене version 3")

        ranges_by_segment: dict[str, list[tuple[float, float, str]]] = {}
        for opening in self.openings:
            length = lengths.get(opening.segment_id)
            if length is None:
                raise ValueError(f"проём {opening.id!r} ссылается на неизвестный сегмент")
            start = opening.offset - opening.width / 2
            end = opening.offset + opening.width / 2
            if start < -GEOMETRY_EPSILON or end > length + GEOMETRY_EPSILON:
                raise ValueError(f"проём {opening.id!r} выходит за пределы стены")
            ranges_by_segment.setdefault(opening.segment_id, []).append((start, end, opening.id))

        for ranges in ranges_by_segment.values():
            ranges.sort()
            for (_, previous_end, previous_id), (next_start, _, next_id) in zip(ranges, ranges[1:]):
                if next_start < previous_end - GEOMETRY_EPSILON:
                    raise ValueError(f"проёмы {previous_id!r} и {next_id!r} накладываются друг на друга")

        return self

    def to_document(self) -> dict[str, Any]:
        """То, что ложится в floor_plans.scene: версия хранится отдельной колонкой."""
        return self.model_dump(mode="json", exclude={"version"})


class SceneRead(BaseModel):
    """Сцена в ответе API — всегда в актуальной версии (см. upgrade_scene)."""

    version: Literal[3]
    nodes: list[SceneNode]
    segments: list[SceneSegment]
    openings: list[SceneOpening]


def upgrade_scene(document: dict[str, Any], version: int) -> SceneRead:
    """
    Поднимает сохранённый документ до актуальной версии при чтении, не
    переписывая его в базе. v2 → v3: появляется пустой список проёмов.
    """
    if version not in (2, CURRENT_SCENE_VERSION):
        raise ValueError(f"неизвестная версия сцены: {version}")
    return SceneRead(
        version=CURRENT_SCENE_VERSION,
        nodes=document.get("nodes", []),
        segments=document.get("segments", []),
        openings=document.get("openings", []),
    )
