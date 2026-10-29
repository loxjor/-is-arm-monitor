import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import AppUser, AuditLog, Employee
from tests.conftest import SEED_PASSWORD, login

# (логин демо-пользователя, ожидаемый код для каждого маршрута ниже)
PROTECTED_ROUTES = ["/api/v1/users", "/api/v1/roles", "/api/v1/audit-log"]
ROLE_EXPECTATIONS = [
    ("admin", 200),
    ("sysadmin", 403),
    ("head", 403),
    ("depthead", 403),
    ("employee", 403),
]


@pytest.mark.parametrize("path", PROTECTED_ROUTES)
def test_no_token_is_401(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", PROTECTED_ROUTES)
def test_garbage_token_is_401(client: TestClient, path: str) -> None:
    assert client.get(path, headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


@pytest.mark.parametrize(("user_login", "expected"), ROLE_EXPECTATIONS)
def test_role_matrix(client: TestClient, user_login: str, expected: int) -> None:
    headers = login(client, user_login)
    for path in PROTECTED_ROUTES:
        assert client.get(path, headers=headers).status_code == expected, path


def test_me_returns_permissions_and_scope(client: TestClient) -> None:
    body = client.get("/api/v1/auth/me", headers=login(client, "depthead")).json()
    assert body["role"]["code"] == "dept_head"
    assert body["scope"] == "department"
    assert "view_reports" in body["permissions"]
    assert "manage_users" not in body["permissions"]


def test_login_updates_last_login_and_audit(client: TestClient, db: Session) -> None:
    login(client, "head")
    user = db.scalar(select(AppUser).where(AppUser.login == "head"))
    assert user is not None and user.last_login_at is not None
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "login"))
    assert entry is not None and entry.user_id == user.user_id


@pytest.mark.parametrize(
    ("user_login", "password", "reason"),
    [("head", "wrong-password", "wrong_password"), ("nobody", "whatever-1", "unknown_login")],
)
def test_failed_login_is_401_and_logged_without_password(
    client: TestClient, db: Session, user_login: str, password: str, reason: str
) -> None:
    response = client.post("/api/v1/auth/login", json={"login": user_login, "password": password})
    assert response.status_code == 401
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "login_failed"))
    assert entry is not None and entry.details is not None
    assert json.loads(entry.details)["reason"] == reason
    assert password not in entry.details


def test_blocked_user_loses_access_immediately(client: TestClient, db: Session) -> None:
    admin = login(client, "admin")
    employee_headers = login(client, "employee")
    user = db.scalar(select(AppUser).where(AppUser.login == "employee"))
    assert user is not None

    response = client.patch(f"/api/v1/users/{user.user_id}", json={"is_active": False}, headers=admin)
    assert response.status_code == 200

    # Старый токен ещё не истёк, но блокировка действует сразу.
    assert client.get("/api/v1/auth/me", headers=employee_headers).status_code == 401
    blocked = client.post("/api/v1/auth/login", json={"login": "employee", "password": SEED_PASSWORD})
    assert blocked.status_code == 401


def test_admin_cannot_block_self(client: TestClient, db: Session) -> None:
    headers = login(client, "admin")
    admin = db.scalar(select(AppUser).where(AppUser.login == "admin"))
    assert admin is not None
    response = client.patch(f"/api/v1/users/{admin.user_id}", json={"is_active": False}, headers=headers)
    assert response.status_code == 409


def test_token_of_deleted_user_is_401(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {create_access_token(999_999)}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_create_user_and_conflicts(client: TestClient, db: Session) -> None:
    headers = login(client, "admin")
    dept_id = db.scalars(select(Employee.dept_id)).first()
    employee = Employee(full_name="Новиков Пётр", position="Специалист", is_mol=False, dept_id=dept_id)
    db.add(employee)
    db.commit()
    roles = {r["code"]: r["role_id"] for r in client.get("/api/v1/roles", headers=headers).json()}

    payload = {
        "login": "novikov",
        "password": "secure-pass-1",
        "role_id": roles["employee"],
        "employee_id": employee.employee_id,
    }
    created = client.post("/api/v1/users", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    assert created.json()["employee"]["full_name"] == "Новиков Пётр"
    assert "password_hash" not in created.json()

    assert client.post("/api/v1/users", json=payload, headers=headers).status_code == 409
    other_login = {**payload, "login": "novikov2"}
    assert client.post("/api/v1/users", json=other_login, headers=headers).status_code == 409

    login(client, "novikov", "secure-pass-1")
    audit = db.scalar(select(AuditLog).where(AuditLog.action == "create", AuditLog.entity == "app_user"))
    assert audit is not None and "secure-pass-1" not in (audit.details or "")


def test_password_over_72_bytes_rejected(client: TestClient) -> None:
    headers = login(client, "admin")
    payload = {"login": "longpass", "password": "я" * 40, "role_id": 1, "employee_id": 1}
    assert client.post("/api/v1/users", json=payload, headers=headers).status_code == 422


def test_audit_log_filters(client: TestClient) -> None:
    headers = login(client, "admin")
    client.post("/api/v1/auth/login", json={"login": "head", "password": "bad-password"})
    page = client.get("/api/v1/audit-log", params={"action": "login_failed"}, headers=headers).json()
    assert page["total"] == 1
    assert page["items"][0]["action"] == "login_failed"
