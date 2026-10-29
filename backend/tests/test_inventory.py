from fastapi.testclient import TestClient

from tests.conftest import login


def _building_id(client: TestClient, headers: dict[str, str]) -> int:
    territories = client.get("/api/v1/inventory/territories", headers=headers).json()
    assert territories, "нет подконтрольных территорий в демо-данных"
    return territories[0]["building_id"]


def _room_id(client: TestClient, headers: dict[str, str], building_id: int, room_no: str) -> int:
    rooms = client.get(f"/api/v1/inventory/territories/{building_id}/rooms", headers=headers).json()
    return next(r["room_id"] for r in rooms if r["room_no"] == room_no)


def test_territories_and_rooms(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    territories = client.get("/api/v1/inventory/territories", headers=headers).json()
    assert len(territories) == 1
    assert territories[0]["name"] == "Главное здание"
    assert territories[0]["equipment_count"] == 12

    building_id = territories[0]["building_id"]
    rooms = client.get(f"/api/v1/inventory/territories/{building_id}/rooms", headers=headers).json()
    assert {r["room_no"] for r in rooms} == {"301", "302", "105"}
    assert next(r for r in rooms if r["room_no"] == "301")["equipment_count"] == 6

    assert client.get("/api/v1/inventory/territories/99999/rooms", headers=headers).status_code == 404


def test_start_scan_mark_finish(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    building_id = _building_id(client, headers)
    room_301 = _room_id(client, headers, building_id, "301")

    start = client.post("/api/v1/inventory", headers=headers,
                        json={"basis": "Приказ №1", "building_id": building_id, "room_id": room_301})
    assert start.status_code == 201, start.text
    detail = start.json()
    assert detail["total_count"] == 6
    assert detail["checked_count"] == 0
    assert detail["status"] == "open"
    assert detail["room_no"] == "301"
    assert all(not item["checked"] for item in detail["items"])
    inventory_id = detail["inventory_id"]

    # Отметка сканером по инвентарному номеру.
    first = detail["items"][0]
    scanned = client.post(f"/api/v1/inventory/{inventory_id}/scan",
                          json={"code": first["inventory_no"]}, headers=headers).json()
    assert scanned["checked"] and scanned["is_present"]

    # Отметка по QR-ссылке на карточку.
    second = detail["items"][1]
    via_url = client.post(f"/api/v1/inventory/{inventory_id}/scan",
                          json={"code": f"https://host/admin.html#/equipment/{second['equipment_id']}"},
                          headers=headers).json()
    assert via_url["checked"] and via_url["is_present"]

    # Ручная отметка «не найден».
    third = detail["items"][2]
    marked = client.post(f"/api/v1/inventory/{inventory_id}/items/{third['equipment_id']}",
                         json={"is_present": False, "discrepancy": "missing"}, headers=headers).json()
    assert marked["checked"] and not marked["is_present"] and marked["discrepancy"] == "missing"

    # Неизвестный код — 404.
    assert client.post(f"/api/v1/inventory/{inventory_id}/scan",
                       json={"code": "NOPE"}, headers=headers).status_code == 404

    history = client.get("/api/v1/inventory", headers=headers).json()
    assert history["total"] == 1
    assert history["items"][0]["checked_count"] == 3
    assert history["items"][0]["present_count"] == 2

    finished = client.post(f"/api/v1/inventory/{inventory_id}/finish", headers=headers)
    assert finished.status_code == 200
    assert finished.json()["status"] == "closed"
    assert finished.json()["finished_on"] is not None

    # После завершения отметки запрещены.
    assert client.post(f"/api/v1/inventory/{inventory_id}/scan",
                       json={"code": first["inventory_no"]}, headers=headers).status_code == 404


def test_reset_item_to_unchecked(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    building_id = _building_id(client, headers)
    room_301 = _room_id(client, headers, building_id, "301")
    start = client.post("/api/v1/inventory", headers=headers,
                        json={"basis": "Приказ", "building_id": building_id, "room_id": room_301}).json()
    inventory_id = start["inventory_id"]
    item = start["items"][0]

    present = client.post(f"/api/v1/inventory/{inventory_id}/items/{item['equipment_id']}",
                          json={"checked": True, "is_present": True}, headers=headers).json()
    assert present["checked"] and present["is_present"]

    reset = client.post(f"/api/v1/inventory/{inventory_id}/items/{item['equipment_id']}",
                        json={"checked": False, "is_present": False}, headers=headers).json()
    assert not reset["checked"] and not reset["is_present"] and reset["discrepancy"] is None


def test_start_unknown_room_rejected(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    building_id = _building_id(client, headers)
    assert client.post("/api/v1/inventory", headers=headers,
                       json={"basis": "x", "building_id": building_id, "room_id": 99999}).status_code == 404


def test_only_conduct_inventory_roles(client: TestClient) -> None:
    for user_login in ("employee", "head", "depthead"):
        assert client.get("/api/v1/inventory", headers=login(client, user_login)).status_code == 403, user_login
