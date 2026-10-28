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
        # Сцена всегда отдаётся в актуальной версии: плоский v2 становится единственным этажом.
        assert body["scene"]["version"] == 4
        [floor] = body["scene"]["floors"]
        assert (floor["id"], floor["name"]) == ("floor-1", "1 этаж")
        assert floor["openings"] == []
        assert floor["rooms"] == []
        assert [node["id"] for node in floor["nodes"]] == ["n1", "n2", "n3", "n4"]
        assert floor["segments"][0] == {
            "id": "s1",
            "start_node_id": "n1",
            "end_node_id": "n2",
            "thickness": 10,
        }
        assert body["workspaces"][0]["client_id"] == "ws-1"
        assert body["workspaces"][0]["floor_id"] == "floor-1"

    def test_v3_with_openings_round_trip(self, client: TestClient) -> None:
        created = client.post(URL, json=with_door(room_payload()))
        assert created.status_code == 201, created.text
        opening = created.json()["scene"]["floors"][0]["openings"][0]
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


    def territory(self, client: TestClient, name: str = "Корпус А") -> int:
        body = {"name": name, "address": "г. Москва, ул. Тестовая, 1", "latitude": 55.75, "longitude": 37.61}
        return client.post("/api/v1/territories", json=body).json()["building_id"]

    def test_list_has_territory_description_and_desk_count(self, client: TestClient) -> None:
        building_id = self.territory(client)
        payload = room_payload()
        payload["building_id"] = building_id
        payload["description"] = "  Второй этаж, отдел кадров "
        client.post(URL, json=payload)
        client.post(URL, json=room_payload())
        listed = client.get(URL).json()
        assert len(listed) == 2
        [mine] = client.get(URL, params={"building_id": building_id}).json()
        assert mine["building_id"] == building_id
        # Схема территории называется как территория, а не как прислали.
        assert mine["name"] == "Корпус А"
        assert mine["description"] == "Второй этаж, отдел кадров"
        assert mine["workspace_count"] == 1

    def test_territory_plan_needs_no_name(self, client: TestClient) -> None:
        payload = room_payload()
        del payload["name"]
        assert client.post(URL, json=payload).status_code == 422  # без территории название нужно
        payload["building_id"] = self.territory(client)
        body = client.post(URL, json=payload).json()
        assert body["name"] == "Корпус А"

    def test_one_plan_per_territory(self, client: TestClient) -> None:
        payload = room_payload()
        payload["building_id"] = self.territory(client)
        assert client.post(URL, json=payload).status_code == 201
        assert client.post(URL, json=payload).status_code == 409
        other = client.post(URL, json=room_payload()).json()["id"]
        assert client.patch(f"{URL}/{other}", json={"building_id": payload["building_id"]}).status_code == 409

    def test_renaming_territory_renames_its_plan(self, client: TestClient) -> None:
        building_id = self.territory(client)
        payload = room_payload()
        payload["building_id"] = building_id
        plan_id = client.post(URL, json=payload).json()["id"]
        client.patch(f"/api/v1/territories/{building_id}", json={"name": "Корпус Б"})
        assert client.get(f"{URL}/{plan_id}").json()["name"] == "Корпус Б"
        # Отвязанная схема сохраняет имя территории.
        assert client.patch(f"{URL}/{plan_id}", json={"building_id": None}).json()["name"] == "Корпус Б"

    def test_put_from_editor_keeps_territory_and_description(self, client: TestClient) -> None:
        payload = room_payload()
        payload["building_id"] = self.territory(client)
        payload["description"] = "Описание"
        plan_id = client.post(URL, json=payload).json()["id"]
        # Редактор шлёт план без территории и описания — они не должны пропасть,
        # а присланное название не заменяет имя территории.
        body = client.put(f"{URL}/{plan_id}", json=room_payload()).json()
        assert body["building_id"] == payload["building_id"]
        assert body["description"] == "Описание"
        assert body["name"] == "Корпус А"

    def test_patch_changes_only_given_fields(self, client: TestClient) -> None:
        building_id = self.territory(client)
        plan_id = client.post(URL, json=room_payload()).json()["id"]
        body = client.patch(f"{URL}/{plan_id}", json={"building_id": building_id, "description": "  "}).json()
        assert body["name"] == "Корпус А"
        assert body["building_id"] == building_id
        assert body["description"] is None
        assert body["workspaces"]  # геометрию PATCH не трогает
        # Название схемы территории не меняется — только у схемы без территории.
        assert client.patch(f"{URL}/{plan_id}", json={"name": "Склад"}).json()["name"] == "Корпус А"
        body = client.patch(f"{URL}/{plan_id}", json={"name": "Склад", "building_id": None}).json()
        assert body["name"] == "Склад"
        assert body["building_id"] is None

    def test_unknown_territory_is_rejected(self, client: TestClient) -> None:
        payload = room_payload()
        payload["building_id"] = 999
        assert client.post(URL, json=payload).status_code == 422
        plan_id = client.post(URL, json=room_payload()).json()["id"]
        assert client.patch(f"{URL}/{plan_id}", json={"building_id": 999}).status_code == 422

    def test_patch_rejects_unknown_field_and_missing_plan(self, client: TestClient) -> None:
        plan_id = client.post(URL, json=room_payload()).json()["id"]
        assert client.patch(f"{URL}/{plan_id}", json={"scene": {}}).status_code == 422
        assert client.patch(f"{URL}/{plan_id}", json={"name": ""}).status_code == 422
        assert client.patch(f"{URL}/999", json={"name": "X"}).status_code == 404

    def test_delete_removes_plan(self, client: TestClient) -> None:
        plan_id = client.post(URL, json=room_payload()).json()["id"]
        assert client.delete(f"{URL}/{plan_id}").status_code == 204
        assert client.get(f"{URL}/{plan_id}").status_code == 404
        assert client.delete(f"{URL}/{plan_id}").status_code == 404

    def test_room_names_round_trip(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["rooms"] = [
            {"id": "r1", "x": 150, "y": 125, "title": "Коридор", "note": "бывший каб. 3"},
            {"id": "r2", "x": 50, "y": 50, "title": "каб. 4"},
        ]
        created = client.post(URL, json=payload)
        assert created.status_code == 201, created.text
        body = client.get(f"{URL}/{created.json()['id']}").json()
        assert body["scene"]["floors"][0]["rooms"] == [
            {"id": "r1", "x": 150, "y": 125, "title": "Коридор", "note": "бывший каб. 3"},
            {"id": "r2", "x": 50, "y": 50, "title": "каб. 4", "note": ""},
        ]


    def test_floors_round_trip(self, client: TestClient) -> None:
        created = client.post(URL, json=two_floors_payload())
        assert created.status_code == 201, created.text
        body = client.get(f"{URL}/{created.json()['id']}").json()
        assert body["scene"]["version"] == 4
        assert [(f["id"], f["name"]) for f in body["scene"]["floors"]] == [("f1", "1 этаж"), ("f2", "2 этаж")]
        assert [n["id"] for n in body["scene"]["floors"][1]["nodes"]] == ["m1", "m2"]
        assert {w["client_id"]: w["floor_id"] for w in body["workspaces"]} == {"ws-1": "f1", "ws-2": "f2"}
        assert [(f["kind"], f["variant"], f["rotation"]) for f in body["scene"]["floors"][1]["fixtures"]] == [
            ("stairs", "u-two", 90),
            ("elevator", None, 0),
        ]
        assert body["scene"]["floors"][0]["fixtures"] == []


def two_floors_payload() -> dict[str, Any]:
    """Тот же план, но двумя этажами: на втором — одна стена и своё рабочее место."""
    payload = room_payload()
    flat = payload["scene"]
    payload["scene"] = {
        "version": 4,
        "floors": [
            {"id": "f1", "name": "1 этаж", "nodes": flat["nodes"], "segments": flat["segments"]},
            {
                "id": "f2",
                "name": "2 этаж",
                "nodes": [{"id": "m1", "x": 0, "y": 0}, {"id": "m2", "x": 200, "y": 0}],
                "segments": [{"id": "t1", "start_node_id": "m1", "end_node_id": "m2", "thickness": 10}],
                "fixtures": [
                    {"id": "st1", "kind": "stairs", "variant": "u-two", "x": 100, "y": 100, "width": 240, "height": 300, "rotation": 90},
                    {"id": "el1", "kind": "elevator", "x": 300, "y": 100, "width": 160, "height": 160},
                ],
            },
        ],
    }
    payload["workspaces"][0]["floor_id"] = "f1"
    payload["workspaces"].append({**payload["workspaces"][0], "client_id": "ws-2", "floor_id": "f2"})
    return payload


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

    def test_empty_room_title(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["rooms"] = [{"id": "r1", "x": 150, "y": 125, "title": ""}]
        self.post(client, payload)

    def test_duplicate_room_id(self, client: TestClient) -> None:
        payload = room_payload()
        room = {"id": "r1", "x": 150, "y": 125, "title": "каб. 1"}
        payload["scene"]["rooms"] = [room, {**room, "x": 50}]
        self.post(client, payload)

    def test_workspace_on_unknown_floor(self, client: TestClient) -> None:
        payload = two_floors_payload()
        payload["workspaces"][1]["floor_id"] = "f9"
        self.post(client, payload)

    def test_floor_graph_is_checked(self, client: TestClient) -> None:
        payload = two_floors_payload()
        # Сегмент второго этажа не может опираться на узел первого.
        payload["scene"]["floors"][1]["segments"][0]["end_node_id"] = "n1"
        self.post(client, payload)

    def test_v4_without_floors(self, client: TestClient) -> None:
        payload = room_payload()
        payload["scene"]["version"] = 4
        self.post(client, payload)

    def test_unknown_fixture_kind(self, client: TestClient) -> None:
        payload = two_floors_payload()
        payload["scene"]["floors"][1]["fixtures"][0]["kind"] = "escalator"
        self.post(client, payload)

    def test_unknown_stair_variant(self, client: TestClient) -> None:
        payload = two_floors_payload()
        payload["scene"]["floors"][1]["fixtures"][0]["variant"] = "escalator"
        self.post(client, payload)

    def test_duplicate_floor_id(self, client: TestClient) -> None:
        payload = two_floors_payload()
        payload["scene"]["floors"][1]["id"] = "f1"
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
