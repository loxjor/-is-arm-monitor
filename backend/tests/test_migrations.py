from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BACKEND_DIR = Path(__file__).resolve().parent.parent
GRAPH_REVISION = "a1c9e6f2b3d4"


def alembic_config(url: str, monkeypatch: pytest.MonkeyPatch) -> Config:
    # env.py берёт URL из настроек приложения — подменяем его на временную базу.
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATABASE_URL", url)
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


def test_scene_migration_moves_wall_graph_into_json_and_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = f"sqlite:///{tmp_path / 'migrate.db'}"
    config = alembic_config(url, monkeypatch)
    command.upgrade(config, GRAPH_REVISION)

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO floor_plans (id, name, width_cm, height_cm) "
                "VALUES (1, 'План', 5000, 5000)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO wall_nodes (id, floor_plan_id, x, y) "
                "VALUES (10, 1, 0, 0), (11, 1, 300, 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO wall_segments (id, floor_plan_id, start_node_id, end_node_id, thickness) "
                "VALUES (20, 1, 10, 11, 12)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO workspaces (id, floor_plan_id, x, y, width, height, rotation, label, status) "
                "VALUES (30, 1, 1, 2, 120, 80, 0, 'Стол', 'free')"
            )
        )

    command.upgrade(config, "head")

    tables = inspect(engine).get_table_names()
    assert "wall_nodes" not in tables
    assert "wall_segments" not in tables

    import json

    with engine.connect() as connection:
        scene_raw, version = connection.execute(
            text("SELECT scene, scene_version FROM floor_plans WHERE id = 1")
        ).one()
        client_id = connection.execute(
            text("SELECT client_id FROM workspaces WHERE id = 30")
        ).scalar_one()

    scene = json.loads(scene_raw) if isinstance(scene_raw, str) else scene_raw
    assert version == 2
    assert scene["nodes"] == [
        {"id": "node-10", "x": 0.0, "y": 0.0},
        {"id": "node-11", "x": 300.0, "y": 0.0},
    ]
    assert scene["segments"] == [
        {"id": "wall-20", "start_node_id": "node-10", "end_node_id": "node-11", "thickness": 12.0}
    ]
    assert client_id == "workspace-30"

    command.downgrade(config, GRAPH_REVISION)

    with engine.connect() as connection:
        nodes = connection.execute(text("SELECT x, y FROM wall_nodes ORDER BY x")).all()
        segments = connection.execute(text("SELECT thickness FROM wall_segments")).all()
    assert [tuple(row) for row in nodes] == [(0.0, 0.0), (300.0, 0.0)]
    assert [tuple(row) for row in segments] == [(12.0,)]
    engine.dispose()


def test_floors_migration_keeps_first_floor_on_downgrade(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    url = f"sqlite:///{tmp_path / 'floors.db'}"
    config = alembic_config(url, monkeypatch)
    command.upgrade(config, "head")

    floors = {
        "floors": [
            {"id": "f1", "name": "1 этаж", "nodes": [{"id": "a", "x": 0, "y": 0}], "segments": [], "openings": [], "rooms": []},
            {"id": "f2", "name": "2 этаж", "nodes": [{"id": "b", "x": 5, "y": 5}], "segments": [], "openings": [], "rooms": []},
        ]
    }
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO floor_plans (id, name, width_cm, height_cm, scene, scene_version) "
                "VALUES (1, 'План', 5000, 5000, :scene, 4)"
            ),
            {"scene": json.dumps(floors)},
        )
        connection.execute(
            text(
                "INSERT INTO workspaces (id, floor_plan_id, client_id, x, y, width, height, rotation, label, status, floor_id) "
                "VALUES (1, 1, 'ws', 1, 2, 120, 80, 0, 'Стол', 'free', 'f2')"
            )
        )

    command.downgrade(config, "-1")

    with engine.connect() as connection:
        scene_raw, version = connection.execute(
            text("SELECT scene, scene_version FROM floor_plans WHERE id = 1")
        ).one()
        columns = [column["name"] for column in inspect(engine).get_columns("workspaces")]
    scene = json.loads(scene_raw) if isinstance(scene_raw, str) else scene_raw
    assert version == 3
    assert scene["nodes"] == [{"id": "a", "x": 0, "y": 0}]
    assert "floor_id" not in columns
    engine.dispose()
