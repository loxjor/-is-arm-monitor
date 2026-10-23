from fastapi.testclient import TestClient

from tests.conftest import login


def _own_equipment(client: TestClient, headers: dict[str, str], type_name: str = "Системный блок") -> dict:
    items = client.get("/api/v1/equipment", params={"limit": 500}, headers=headers).json()["items"]
    return next(i for i in items if i["type_name"] == type_name)


def _create(client: TestClient, headers: dict[str, str], **payload: object) -> dict:
    response = client.post("/api/v1/tickets", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _move(client: TestClient, headers: dict[str, str], ticket_id: int, to: str, **extra: object) -> dict:
    response = client.post(f"/api/v1/tickets/{ticket_id}/transitions", json={"to": to, **extra}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_repair_cycle_moves_equipment_through_repair(client: TestClient) -> None:
    employee, sysadmin = login(client, "employee"), login(client, "sysadmin")
    pc = _own_equipment(client, employee)
    ticket = _create(client, employee, ticket_type="repair", equipment_id=pc["equipment_id"],
                     description="Не включается", priority="high")
    assert ticket["status"] == "new" and ticket["requester_name"] == "Смирнова Анна Викторовна"
    # Заявитель не может сам взять заявку в работу.
    assert ticket["can_transition_to"] == []

    taken = _move(client, sysadmin, ticket["ticket_id"], "in_progress")
    assert taken["assignee_name"] == "Кузнецов Дмитрий Олегович" and taken["can_add_work"]
    card = client.get(f"/api/v1/equipment/{pc['equipment_id']}", headers=sysadmin).json()
    assert card["status"] == "in_repair"

    worked = client.post(f"/api/v1/tickets/{ticket['ticket_id']}/works",
                         json={"description": "Замена блока питания", "minutes_spent": 40}, headers=sysadmin).json()
    assert [w["work_no"] for w in worked["works"]] == [1]

    done = _move(client, sysadmin, ticket["ticket_id"], "done", comment="Заменён блок питания")
    assert [w["result"] for w in done["works"]] == [None, "Выполнена"]
    card = client.get(f"/api/v1/equipment/{pc['equipment_id']}", headers=sysadmin).json()
    assert card["status"] == "in_use"

    # Заявитель видит, что заявку можно закрыть или вернуть.
    as_requester = client.get(f"/api/v1/tickets/{ticket['ticket_id']}", headers=employee).json()
    assert set(as_requester["can_transition_to"]) == {"closed", "in_progress"}
    closed = _move(client, employee, ticket["ticket_id"], "closed")
    assert closed["status"] == "closed" and closed["closed_at"] is not None


def test_unrepairable_sends_to_writeoff(client: TestClient) -> None:
    sysadmin = login(client, "sysadmin")
    pc = _own_equipment(client, login(client, "employee"))
    ticket = _create(client, sysadmin, ticket_type="repair", equipment_id=pc["equipment_id"], description="Сгорел")
    _move(client, sysadmin, ticket["ticket_id"], "in_progress")
    _move(client, sysadmin, ticket["ticket_id"], "done", comment="Выгорела плата", unrepairable=True)
    card = client.get(f"/api/v1/equipment/{pc['equipment_id']}", headers=sysadmin).json()
    assert card["status"] == "pending_writeoff"


def test_reject_requires_reason_and_invalid_transitions(client: TestClient) -> None:
    sysadmin = login(client, "sysadmin")
    ticket = _create(client, sysadmin, ticket_type="install", description="Нужно рабочее место для стажёра")
    url = f"/api/v1/tickets/{ticket['ticket_id']}/transitions"
    assert client.post(url, json={"to": "rejected"}, headers=sysadmin).status_code == 409
    assert client.post(url, json={"to": "done"}, headers=sysadmin).status_code == 409
    rejected = _move(client, sysadmin, ticket["ticket_id"], "rejected", comment="Нет свободных мест")
    assert rejected["status"] == "rejected" and rejected["works"][0]["description"] == "Нет свободных мест"
    assert client.post(url, json={"to": "in_progress"}, headers=sysadmin).status_code == 409


def test_repair_requires_equipment_and_visibility(client: TestClient) -> None:
    employee = login(client, "employee")
    assert client.post("/api/v1/tickets", json={"ticket_type": "repair", "description": "Сломалось"},
                       headers=employee).status_code == 409
    # Чужое оборудование сотрудник не видит — и заявку на него подать не может.
    everything = client.get("/api/v1/equipment", params={"limit": 500}, headers=login(client, "sysadmin")).json()
    foreign = next(i for i in everything["items"] if i["workplace_no"] != "301-1")
    response = client.post("/api/v1/tickets", json={"ticket_type": "repair", "description": "Сломалось",
                                                    "equipment_id": foreign["equipment_id"]}, headers=employee)
    assert response.status_code == 422


def test_scope_and_permissions(client: TestClient) -> None:
    employee, sysadmin, head = login(client, "employee"), login(client, "sysadmin"), login(client, "head")
    mine = _create(client, employee, ticket_type="install", description="Второй монитор")
    others = _create(client, sysadmin, ticket_type="install", description="Чужая заявка")

    visible = {t["ticket_id"] for t in client.get("/api/v1/tickets", headers=employee).json()["items"]}
    assert mine["ticket_id"] in visible and others["ticket_id"] not in visible
    assert client.get(f"/api/v1/tickets/{others['ticket_id']}", headers=employee).status_code == 404

    # Начальник отдела видит всё, но заявки не подаёт и не исполняет.
    assert client.get(f"/api/v1/tickets/{mine['ticket_id']}", headers=head).status_code == 200
    assert client.post("/api/v1/tickets", json={"ticket_type": "install", "description": "x" * 5},
                       headers=head).status_code == 403
    assert client.post(f"/api/v1/tickets/{mine['ticket_id']}/transitions", json={"to": "in_progress"},
                       headers=head).status_code == 403
    assert client.post(f"/api/v1/tickets/{mine['ticket_id']}/works", json={"description": "Тест"},
                       headers=employee).status_code == 403


def test_filters_and_summary(client: TestClient) -> None:
    sysadmin = login(client, "sysadmin")
    first = _create(client, sysadmin, ticket_type="install", description="Раз")
    _create(client, sysadmin, ticket_type="install", description="Два")
    _move(client, sysadmin, first["ticket_id"], "in_progress")

    mine = client.get("/api/v1/tickets", params={"assigned_to_me": True}, headers=sysadmin).json()
    assert first["ticket_id"] in {t["ticket_id"] for t in mine["items"]}
    assert all(t["assignee_name"] == "Кузнецов Дмитрий Олегович" for t in mine["items"])
    summary = client.get("/api/v1/tickets/summary", headers=sysadmin).json()
    assert summary["in_progress"] >= 1 and summary["new"] >= 1
