from datetime import date

from fastapi.testclient import TestClient

from app.services.equipment_service import add_months
from tests.conftest import login


def _new_equipment(client: TestClient, headers: dict[str, str], inventory_no: str) -> dict:
    model_id = client.get("/api/v1/equipment-models", headers=headers).json()["items"][0]["model_id"]
    payload = {"inventory_no": inventory_no, "model_id": model_id, "ram_gb": 8, "book_value": "41000.50"}
    response = client.post("/api/v1/equipment", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_register_sets_in_stock_and_rejects_duplicate(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    card = _new_equipment(client, headers, "ВТ-777001")
    assert card["status"] == "in_stock"
    assert card["book_value"] == 41000.5
    assert card["workplace_id"] is None

    duplicate = client.post("/api/v1/equipment", json={"inventory_no": "ВТ-777001", "model_id": card["model_id"]},
                            headers=headers)
    assert duplicate.status_code == 409


def test_status_is_not_writable_through_update(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    card = _new_equipment(client, headers, "ВТ-777002")
    payload = {"inventory_no": "ВТ-777002", "model_id": card["model_id"], "status": "written_off", "hostname": "PC-X"}
    updated = client.put(f"/api/v1/equipment/{card['equipment_id']}", json=payload, headers=headers).json()
    assert updated["status"] == "in_stock"
    assert updated["hostname"] == "PC-X"


def test_only_equipment_managers_register(client: TestClient) -> None:
    for user_login in ("employee", "head", "depthead"):
        response = client.post("/api/v1/equipment", json={"inventory_no": "X", "model_id": 1},
                               headers=login(client, user_login))
        assert response.status_code == 403, user_login


def test_scope_employee_sees_only_own(client: TestClient) -> None:
    all_items = client.get("/api/v1/equipment", params={"limit": 500}, headers=login(client, "sysadmin")).json()
    own = client.get("/api/v1/equipment", params={"limit": 500}, headers=login(client, "employee")).json()
    assert all_items["total"] == 17
    # Демо-сотруднику «employee» выдано рабочее место 301-1: системный блок и монитор.
    assert own["total"] == 2
    assert {i["workplace_no"] for i in own["items"]} == {"301-1"}
    assert all(i["holder_name"] == "Смирнова Анна Викторовна" for i in own["items"])
    hidden_id = next(i["equipment_id"] for i in all_items["items"] if i["workplace_no"] != "301-1")
    assert client.get(f"/api/v1/equipment/{hidden_id}", headers=login(client, "employee")).status_code == 404


def test_scope_dept_head_sees_department(client: TestClient) -> None:
    # depthead — руководитель отдела техподдержки: там нет ни помещений, ни МОЛ с техникой.
    response = client.get("/api/v1/equipment", headers=login(client, "depthead")).json()
    assert response["total"] == 0
    # head (Петров, ОА-1) — scope all, видит всё.
    assert client.get("/api/v1/equipment", headers=login(client, "head")).json()["total"] == 17


def test_filters(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    in_stock = client.get("/api/v1/equipment", params={"status": "in_stock"}, headers=headers).json()
    assert in_stock["total"] == 3 and all(i["status"] == "in_stock" for i in in_stock["items"])

    by_number = client.get("/api/v1/equipment", params={"q": "ВТ-001001"}, headers=headers).json()
    assert [i["inventory_no"] for i in by_number["items"]] == ["ВТ-001001"]

    rooms = client.get("/api/v1/rooms", headers=headers).json()["items"]
    room_301 = next(r["room_id"] for r in rooms if r["room_no"] == "301")
    in_room = client.get("/api/v1/equipment", params={"room_id": room_301}, headers=headers).json()
    assert in_room["total"] == 6 and all(i["room_no"] == "301" for i in in_room["items"])

    expiring = client.get("/api/v1/equipment", params={"expiring_within_months": 0}, headers=headers).json()
    assert all(date.fromisoformat(i["service_end"]) <= date.today() for i in expiring["items"])
    assert any(i["inventory_no"] == "ВТ-000999" for i in expiring["items"])


def test_card_and_summary(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    item = client.get("/api/v1/equipment", params={"q": "ВТ-001001"}, headers=headers).json()["items"][0]
    card = client.get(f"/api/v1/equipment/{item['equipment_id']}", headers=headers).json()
    assert card["type_name"] == "Системный блок"
    assert card["dept_name"] == "Отдел автоматизации № 1"
    assert [a["operation"] for a in card["assignments"]] == ["assign"]
    assert card["holder_name"] == "Смирнова Анна Викторовна"
    summary = client.get("/api/v1/equipment/summary", headers=headers).json()
    assert summary == {"in_use": 12, "in_stock": 3, "in_repair": 1, "pending_writeoff": 1}


def test_add_months_clamps_day() -> None:
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert add_months(date(2023, 11, 15), 14) == date(2025, 1, 15)
