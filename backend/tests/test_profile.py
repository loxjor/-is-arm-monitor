from fastapi.testclient import TestClient

from tests.conftest import login


def test_employee_profile(client: TestClient) -> None:
    profile = client.get("/api/v1/profile", headers=login(client, "employee")).json()
    assert profile["person"]["full_name"] == "Смирнова Анна Викторовна"
    assert profile["person"]["position"] == "Ведущий специалист"
    assert profile["department"]["short_name"] == "ОА-1"
    assert profile["department"]["parent_name"] == "Управление информационных технологий"
    assert profile["head"]["full_name"] == "Петров Сергей Алексеевич"

    [territory] = profile["territories"]
    assert territory["room_no"] == "301" and territory["workplace_no"] == "301-1"
    assert territory["building_address"].startswith("г. Москва")
    assert {item["type_name"] for item in profile["equipment"]} == {"Системный блок", "Монитор"}
    # Демо-заявка на мерцающий монитор ещё не закрыта.
    assert profile["open_tickets"] == 1


def test_update_own_contacts(client: TestClient) -> None:
    headers = login(client, "employee")
    response = client.put("/api/v1/profile", headers=headers,
                          json={"phone": " +7 900 111-22-33 ", "email": "anna@example.ru"})
    assert response.status_code == 200, response.text
    person = response.json()["person"]
    assert (person["phone"], person["email"]) == ("+7 900 111-22-33", "anna@example.ru")
    # ФИО и должность через профиль не меняются, пустое значение очищает контакт.
    cleared = client.put("/api/v1/profile", headers=headers,
                         json={"phone": "", "email": None, "full_name": "Другое", "position": "Другая"}).json()["person"]
    assert cleared["phone"] is None and cleared["email"] is None
    assert cleared["full_name"] == "Смирнова Анна Викторовна" and cleared["position"] == "Ведущий специалист"
    assert client.put("/api/v1/profile", headers=headers, json={"email": "не-почта"}).status_code == 422


def test_change_own_password(client: TestClient) -> None:
    from tests.conftest import SEED_PASSWORD

    headers = login(client, "employee")
    wrong = client.post("/api/v1/profile/password", headers=headers,
                        json={"current_password": "wrong-password", "new_password": "new-password-1"})
    assert wrong.status_code == 400
    same = client.post("/api/v1/profile/password", headers=headers,
                       json={"current_password": SEED_PASSWORD, "new_password": SEED_PASSWORD})
    assert same.status_code == 400
    short = client.post("/api/v1/profile/password", headers=headers,
                        json={"current_password": SEED_PASSWORD, "new_password": "short"})
    assert short.status_code == 422

    ok = client.post("/api/v1/profile/password", headers=headers,
                     json={"current_password": SEED_PASSWORD, "new_password": "new-password-1"})
    assert ok.status_code == 204
    assert client.post("/api/v1/auth/login", json={"login": "employee", "password": SEED_PASSWORD}).status_code == 401
    login(client, "employee", "new-password-1")


def test_profile_without_equipment(client: TestClient) -> None:
    # У администратора ИС нет выданной техники — территория пуста, но профиль строится.
    profile = client.get("/api/v1/profile", headers=login(client, "admin")).json()
    assert profile["person"]["full_name"] == "Морозов Илья Павлович"
    assert profile["territories"] == [] and profile["equipment"] == []
    assert profile["head"]["full_name"] == "Волкова Елена Игоревна"


def test_department_head_is_editable_and_protected(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    departments = client.get("/api/v1/departments", headers=headers).json()["items"]
    automation = next(d for d in departments if d["short_name"] == "ОА-1")
    assert automation["head_employee_id"] is not None

    payload = {**{k: automation[k] for k in ("name", "short_name", "phone", "parent_dept_id")},
               "head_employee_id": 99999}
    assert client.put(f"/api/v1/departments/{automation['dept_id']}", json=payload, headers=headers).status_code == 422

    # Руководителя нельзя удалить из справочника, пока он им числится.
    response = client.delete(f"/api/v1/employees/{automation['head_employee_id']}", headers=headers)
    assert response.status_code == 409 and "подразделения" in response.json()["detail"]


def test_holder_filter(client: TestClient) -> None:
    headers = login(client, "sysadmin")
    profile = client.get("/api/v1/profile", headers=login(client, "employee")).json()
    holder_id = profile["person"]["employee_id"]
    items = client.get("/api/v1/equipment", params={"holder_id": holder_id}, headers=headers).json()["items"]
    assert {i["equipment_id"] for i in items} == {i["equipment_id"] for i in profile["equipment"]}
