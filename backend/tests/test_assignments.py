from fastapi.testclient import TestClient

from tests.conftest import login


def _find(client: TestClient, headers: dict[str, str], **params: str) -> dict:
    items = client.get("/api/v1/equipment", params={**params, "limit": 500}, headers=headers).json()["items"]
    assert items, params
    return items[0]


def _workplace_id(client: TestClient, headers: dict[str, str], number: str) -> int:
    items = client.get("/api/v1/workplaces", params={"q": number}, headers=headers).json()["items"]
    return next(w["workplace_id"] for w in items if w["workplace_no"] == number)


def _employee_id(client: TestClient, headers: dict[str, str], name: str) -> int:
    items = client.get("/api/v1/employees", params={"limit": 1000}, headers=headers).json()["items"]
    return next(e["employee_id"] for e in items if e["full_name"] == name)


def test_full_cycle_assign_move_return(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    unit = _find(client, headers, status="in_stock")
    url = f"/api/v1/equipment/{unit['equipment_id']}/assignments"
    wp_1, wp_2 = _workplace_id(client, headers, "302-1"), _workplace_id(client, headers, "302-2")
    smirnova = _employee_id(client, headers, "Смирнова Анна Викторовна")

    card = client.post(url, json={"operation": "assign", "workplace_id": wp_1, "employee_id": smirnova,
                                  "basis": "Заявка № 15"}, headers=headers)
    assert card.status_code == 201, card.text
    body = card.json()
    assert body["status"] == "in_use" and body["workplace_no"] == "302-1"
    assert body["holder_name"] == "Смирнова Анна Викторовна"

    moved = client.post(url, json={"operation": "move", "workplace_id": wp_2}, headers=headers).json()
    assert moved["workplace_no"] == "302-2"
    # При перемещении без сотрудника пользователь остаётся прежним.
    assert moved["holder_name"] == "Смирнова Анна Викторовна"

    returned = client.post(url, json={"operation": "return", "basis": "Замена"}, headers=headers).json()
    assert returned["status"] == "in_stock"
    assert returned["workplace_id"] is None and returned["holder_name"] is None
    assert [a["operation"] for a in returned["assignments"]] == ["return", "move", "assign"]

    log = client.get("/api/v1/audit-log", params={"entity": "equipment"}, headers=login(client, "admin")).json()
    assert [e["action"] for e in log["items"][:3]] == ["return", "move", "assign"]


def test_invalid_transitions_are_409(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    wp = _workplace_id(client, headers, "302-1")
    in_use = _find(client, headers, status="in_use")
    in_stock = _find(client, headers, status="in_stock")
    in_repair = _find(client, headers, status="in_repair")

    def post(unit: dict, payload: dict) -> int:
        return client.post(f"/api/v1/equipment/{unit['equipment_id']}/assignments", json=payload,
                           headers=headers).status_code

    assert post(in_use, {"operation": "assign", "workplace_id": wp}) == 409
    assert post(in_stock, {"operation": "move", "workplace_id": wp}) == 409
    assert post(in_stock, {"operation": "return"}) == 409
    assert post(in_repair, {"operation": "assign", "workplace_id": wp}) == 409
    # Перемещение туда же, где стоит, — тоже отказ.
    assert post(in_use, {"operation": "move", "workplace_id": in_use["workplace_id"]}) == 409


def test_validation_and_permissions(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    unit = _find(client, headers, status="in_stock")
    url = f"/api/v1/equipment/{unit['equipment_id']}/assignments"
    assert client.post(url, json={"operation": "assign"}, headers=headers).status_code == 422
    assert client.post(url, json={"operation": "assign", "workplace_id": 99999}, headers=headers).status_code == 422
    for user_login in ("head", "depthead", "employee"):
        response = client.post(url, json={"operation": "assign", "workplace_id": 1}, headers=login(client, user_login))
        assert response.status_code == 403, user_login


def test_issued_equipment_becomes_visible_to_employee(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    unit = _find(client, headers, status="in_stock")
    employee_headers = login(client, "employee")
    assert client.get(f"/api/v1/equipment/{unit['equipment_id']}", headers=employee_headers).status_code == 404

    client.post(f"/api/v1/equipment/{unit['equipment_id']}/assignments",
                json={"operation": "assign", "workplace_id": _workplace_id(client, headers, "301-1"),
                      "employee_id": _employee_id(client, headers, "Смирнова Анна Викторовна")},
                headers=headers)
    assert client.get(f"/api/v1/equipment/{unit['equipment_id']}", headers=employee_headers).status_code == 200

    client.post(f"/api/v1/equipment/{unit['equipment_id']}/assignments", json={"operation": "return"}, headers=headers)
    assert client.get(f"/api/v1/equipment/{unit['equipment_id']}", headers=employee_headers).status_code == 404


def test_filter_by_workplace(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    wp = _workplace_id(client, headers, "301-1")
    items = client.get("/api/v1/equipment", params={"workplace_id": wp}, headers=headers).json()["items"]
    assert len(items) == 2 and {i["type_name"] for i in items} == {"Системный блок", "Монитор"}
