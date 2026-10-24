import copy
from typing import Any

from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.main import app

URL = "/api/v1/floor-plans"


@pytest.fixture
def client(empty_client: TestClient) -> Iterator[TestClient]:
    # Тесты редактора карты рассчитаны на пустую базу, без демо-данных учётной
    # части — в ней нет пользователей, поэтому запросы идут от имени фиктивного
    # администратора ИС (права на карты проверяет test_floor_plan_access.py).
    admin = SimpleNamespace(user_id=0, is_active=True, role=SimpleNamespace(code="admin"))
    app.dependency_overrides[get_current_user] = lambda: admin
    yield empty_client
    app.dependency_overrides.pop(get_current_user, None)


def room_payload() -> dict[str, Any]:
    """Комната 300×250 см из четырёх стен толщиной 10 и одно рабочее место."""
    return {
        "name": "Офис",
        "width_cm": 5000,
        "height_cm": 5000,
        "background_image_url": None,
        "scene": {
            "version": 2,
            "nodes": [
                {"id": "n1", "x": 0, "y": 0},
                {"id": "n2", "x": 300, "y": 0},
                {"id": "n3", "x": 300, "y": 250},
                {"id": "n4", "x": 0, "y": 250},
            ],
            "segments": [
                {"id": "s1", "start_node_id": "n1", "end_node_id": "n2", "thickness": 10},
                {"id": "s2", "start_node_id": "n2", "end_node_id": "n3", "thickness": 10},
                {"id": "s3", "start_node_id": "n3", "end_node_id": "n4", "thickness": 10},
                {"id": "s4", "start_node_id": "n4", "end_node_id": "n1", "thickness": 10},
            ],
        },
        "workspaces": [
            {
                "client_id": "ws-1",
                "x": 150,
                "y": 130,
                "width": 120,
                "height": 80,
                "rotation": 0,
                "label": "Стол №1",
                "status": "free",
            }
        ],
    }


def with_door(payload: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    payload = copy.deepcopy(payload)
    payload["scene"]["version"] = 3
    door = {
        "id": "o1",
        "segment_id": "s1",
        "kind": "door",
        "offset": 150,
        "width": 80,
        "height": 210,
        "sill_height": 0,
        "hinge": "start",
        "swing": "left",
    }
    door.update(overrides)
    payload["scene"]["openings"] = [door]
    return payload


def error_locs(response: Any) -> list[tuple[Any, ...]]:
    return [tuple(error["loc"]) for error in response.json()["detail"]]


class TestRoundTrip:
    def test_create_and_read_keep_client_ids(self, client: TestClient) -> None:
        created = client.post(URL, json=room_payload())
        assert created.status_code == 201, created.text
        plan_id = created.json()["id"]

        body = client.get(f"{URL}/{plan_id}").json()
        # Сцена всегда отдаётся в актуальной версии; v2 поднимается до v3 пустым списком проёмов.
        assert body["scene"]["version"] == 3
        assert body["scene"]["openings"] == []
        assert [node["id"] for node in body["scene"]["nodes"]] == ["n1", "n2", "n3", "n4"]
        assert body["scene"]["segments"][0] == {
            "id": "s1",
            "start_node_id": "n1",
            "end_node_id": "n2",
            "thickness": 10,
        }
        assert body["workspaces"][0]["client_id"] == "ws-1"

    def test_v3_with_openings_round_trip(self, client: TestClient) -> None:
        created = client.post(URL, json=with_door(room_payload()))
        assert created.status_code == 201, created.text
        opening = created.json()["scene"]["openings"][0]
        assert opening["segment_id"] == "s1"
        assert opening["kind"] == "door"
        assert opening["swing"] == "left"

    def test_put_keeps_workspace_row_identity(self, client: TestClient) -> None:
        plan_id = client.post(URL, json=room_payload()).json()["id"]
        first_db_id = client.get(f"{URL}/{plan_id}").json()["workspaces"][0]["id"]

        payload = room_payload()
        payload["workspaces"][0]["status"] = "occupied"
        updated = client.put(f"{URL}/{plan_id}", json=payload)
        assert updated.status_code == 200, updated.text

        workspace = updated.json()["workspaces"][0]
        # Рабочее место обновлено на месте, а не удалено и создано заново —
        # на его id смогут ссылаться назначения сотрудников/активов.
        assert workspace["id"] == first_db_id
        assert workspace["status"] == "occupied"

    def test_put_removes_missing_and_adds_new_workspaces(self, client: TestClient) -> None:
        plan_id = client.post(URL, json=room_payload()).json()["id"]
        payload = room_payload()
        payload["workspaces"][0]["client_id"] = "ws-2"
        body = client.put(f"{URL}/{plan_id}", json=payload).json()
        assert [w["client_id"] for w in body["workspaces"]] == ["ws-2"]

    def test_rotation_is_normalized(self, client: TestClient) -> None:
        payload = room_payload()
        payload["workspaces"][0]["rotation"] = 450
        body = client.post(URL, json=payload).json()
        assert body["workspaces"][0]["rotation"] == 90

    def test_get_missing_plan_is_404(self, client: TestClient) -> None:
        assert client.get(f"{URL}/999").status_code == 404

    def test_put_missing_plan_is_404(self, client: TestClient) -> None:
        assert client.put(f"{URL}/999", json=room_payload()).status_code == 404

    def test_list_has_no_scene(self, client: TestClient) -> None:
        client.post(URL, json=room_payload())
        listed = client.get(URL).json()
        assert len(listed) == 1
        assert "scene" not in listed[0]


class TestValidation:
    def post(self, client: TestClient, payload: dict[str, Any]) -> Any:
        response = client.post(URL, json=payload)
        assert response.status_code == 422, response.text
        return response

    def test_unknown_segment_node(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["segments"][0]["end_node_id"] = "missing"
        response = self.post(client, payload)
        assert ("body", "scene") in [loc[:2] for loc in error_locs(response)]

    def test_self_loop_segment(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["segments"][0]["end_node_id"] = "n1"
        self.post(client, payload)

    def test_duplicate_segment_between_same_nodes(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["segments"].append(
            {"id": "s5", "start_node_id": "n2", "end_node_id": "n1", "thickness": 10}
        )
        self.post(client, payload)

    def test_duplicate_node_id(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["nodes"][1]["id"] = "n1"
        self.post(client, payload)

    def test_duplicate_workspace_client_id(self, client: TestClient) -> None:
        payload = room_payload()
        payload["workspaces"].append(copy.deepcopy(payload["workspaces"][0]))
        self.post(client, payload)

    def test_non_finite_coordinate(self, client: TestClient) -> None:
        # json.dumps пропускает NaN как литерал — сервер обязан его отклонить.
        payload = room_payload()
        payload["scene"]["nodes"][0]["x"] = float("nan")
        response = client.post(
            URL,
            content=__import__("json").dumps(payload),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_non_positive_plan_size(self, client: TestClient) -> None:
        payload = room_payload()
        payload["width_cm"] = 0
        self.post(client, payload)

    def test_unknown_field_is_rejected(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["walls"] = []
        self.post(client, payload)

    def test_unknown_version_is_rejected(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["version"] = 7
        self.post(client, payload)

    def test_openings_require_version_3(self, client: TestClient) -> None:
        payload = with_door(room_payload())
        payload["scene"]["version"] = 2
        self.post(client, payload)

    def test_opening_on_unknown_segment(self, client: TestClient) -> None:
        self.post(client, with_door(room_payload(), segment_id="nope"))

    def test_opening_out_of_segment(self, client: TestClient) -> None:
        # Стена s1 длиной 300: центр 280 при ширине 80 вылезает за конец.
        self.post(client, with_door(room_payload(), offset=280))

    def test_overlapping_openings(self, client: TestClient) -> None:
        payload = with_door(room_payload())
        payload["scene"]["openings"].append(
            {**payload["scene"]["openings"][0], "id": "o2", "offset": 200}
        )
        self.post(client, payload)

    def test_door_without_hinge(self, client: TestClient) -> None:
        self.post(client, with_door(room_payload(), hinge=None))
