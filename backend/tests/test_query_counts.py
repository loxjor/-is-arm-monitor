"""Число SQL-запросов на горячих маршрутах — страховка от N+1 и лишних перечитываний.

Перед замером сессия очищается (expunge_all): в тестах она общая для всех
запросов, и объекты, уже лежащие в identity map, скрыли бы ленивые догрузки.
"""

import re
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from tests.conftest import login

# Столбец scene (документ сцены), но не scene_version.
_SCENE_COLUMN = re.compile(r"floor_plans\.scene(?!_)")


@contextmanager
def captured_sql(db: Session) -> Iterator[list[str]]:
    statements: list[str] = []
    engine = db.get_bind()

    def on_execute(_conn, _cursor, statement, _params, _context, _executemany) -> None:  # type: ignore[no-untyped-def]
        statements.append(statement)

    db.expunge_all()
    event.listen(engine, "before_cursor_execute", on_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", on_execute)


def test_current_user_loads_role_and_employee_in_one_query(client: TestClient, db: Session) -> None:
    headers = login(client, "depthead")
    with captured_sql(db) as statements:
        assert client.get("/api/v1/equipment/summary", headers=headers).status_code == 200
    # Пользователь вместе с ролью и сотрудником + сама сводка; область
    # «подразделение» читает user.employee — без догрузки.
    assert len(statements) == 2, statements


def test_users_list_has_no_n_plus_one(client: TestClient, db: Session) -> None:
    headers = login(client, "admin")
    with captured_sql(db) as statements:
        response = client.get("/api/v1/users", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) >= 5
    # Текущий пользователь, список, роли и сотрудники (selectinload) — не
    # зависит от числа пользователей.
    assert len(statements) == 4, statements


def test_floor_plan_list_does_not_read_scene(client: TestClient, db: Session) -> None:
    headers = login(client, "employee")
    with captured_sql(db) as statements:
        response = client.get("/api/v1/floor-plans", headers=headers)
    assert response.status_code == 200
    assert response.json(), "в демо-данных есть план"
    plan_selects = [s for s in statements if "FROM floor_plans" in s]
    assert plan_selects
    assert not any(_SCENE_COLUMN.search(s) for s in plan_selects), plan_selects


def test_floor_plan_card_still_returns_scene(client: TestClient, db: Session) -> None:
    headers = login(client, "employee")
    plan_id = client.get("/api/v1/floor-plans", headers=headers).json()[0]["id"]
    plan = client.get(f"/api/v1/floor-plans/{plan_id}", headers=headers).json()
    assert plan["scene"]["floors"][0]["segments"]


def test_equipment_update_does_not_build_card_twice(client: TestClient, db: Session) -> None:
    headers = login(client, "sysadmin")
    item = client.get("/api/v1/equipment", params={"q": "ВТ-001001"}, headers=headers).json()["items"][0]
    card = client.get(f"/api/v1/equipment/{item['equipment_id']}", headers=headers).json()
    payload = {
        key: card[key]
        for key in ("inventory_no", "serial_no", "hostname", "model_id", "os_id", "mol_id", "commissioned_on",
                    "book_value", "cpu", "ram_gb", "storage_gb", "ip_address")
    }
    payload["hostname"] = "renamed-host"
    with captured_sql(db) as statements:
        response = client.put(f"/api/v1/equipment/{item['equipment_id']}", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["hostname"] == "renamed-host"
    # История назначений читается одна — для итоговой карточки, а не ещё и
    # для проверки видимости перед изменением.
    history = [s for s in statements if "FROM assignment" in s and "ORDER BY assignment.assigned_at DESC" in s]
    assert len(history) == 1, statements
