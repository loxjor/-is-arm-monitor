import pytest
from fastapi.testclient import TestClient

from tests.conftest import login

CATALOG_PATHS = [
    "departments", "employees", "buildings", "rooms", "workplaces",
    "equipment-types", "manufacturers", "equipment-models", "operating-systems",
]


@pytest.mark.parametrize("path", CATALOG_PATHS)
def test_any_user_can_read(client: TestClient, path: str) -> None:
    response = client.get(f"/api/v1/{path}", headers=login(client, "employee"))
    assert response.status_code == 200
    assert response.json()["total"] >= 1


def test_only_catalog_editors_can_write(client: TestClient) -> None:
    for user_login, expected in [("employee", 403), ("head", 403), ("sysadmin", 201), ("admin", 201)]:
        response = client.post("/api/v1/manufacturers", json={"name": f"K-{user_login}", "country": "Россия"},
                               headers=login(client, user_login))
        assert response.status_code == expected, user_login


def test_crud_cycle_and_search(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    created = client.post("/api/v1/operating-systems", json={"name": "Альт", "version": "10", "is_domestic": True},
                          headers=headers)
    assert created.status_code == 201
    os_id = created.json()["os_id"]

    found = client.get("/api/v1/operating-systems", params={"q": "Альт"}, headers=headers).json()
    assert [item["os_id"] for item in found["items"]] == [os_id]

    updated = client.put(f"/api/v1/operating-systems/{os_id}",
                         json={"name": "Альт Рабочая станция", "version": "10.2", "is_domestic": True},
                         headers=headers)
    assert updated.json()["version"] == "10.2"

    assert client.delete(f"/api/v1/operating-systems/{os_id}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/operating-systems/{os_id}", headers=headers).status_code == 404


def test_delete_used_record_is_409_with_usage(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    models = client.get("/api/v1/equipment-models", headers=headers).json()["items"]
    response = client.delete(f"/api/v1/equipment-models/{models[0]['model_id']}", headers=headers)
    assert response.status_code == 409
    assert "оборудование" in response.json()["detail"]


def test_unknown_parent_is_422(client: TestClient) -> None:
    response = client.post("/api/v1/rooms", json={"room_no": "999", "floor": 1, "building_id": 12345},
                           headers=login(client, "sysadmin"))
    assert response.status_code == 422


def test_filter_by_foreign_key(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    rooms = client.get("/api/v1/rooms", headers=headers).json()["items"]
    room_id = next(r["room_id"] for r in rooms if r["room_no"] == "301")
    workplaces = client.get("/api/v1/workplaces", params={"room_id": room_id}, headers=headers).json()["items"]
    assert workplaces and all(w["room_id"] == room_id for w in workplaces)


def test_department_cycle_rejected(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    departments = client.get("/api/v1/departments", headers=headers).json()["items"]
    root = next(d for d in departments if d["parent_dept_id"] is None)
    child = next(d for d in departments if d["parent_dept_id"] == root["dept_id"])
    payload = {"name": root["name"], "short_name": root["short_name"], "phone": root["phone"],
               "parent_dept_id": child["dept_id"]}
    assert client.put(f"/api/v1/departments/{root['dept_id']}", json=payload, headers=headers).status_code == 409
