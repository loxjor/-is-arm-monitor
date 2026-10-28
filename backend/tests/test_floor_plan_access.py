from fastapi.testclient import TestClient

from tests.conftest import login

URL = "/api/v1/floor-plans"


def _plan_payload(client: TestClient, headers: dict[str, str]) -> dict:
    plan = client.get(f"{URL}/1", headers=headers).json()
    return {
        "name": plan["name"],
        "width_cm": plan["width_cm"],
        "height_cm": plan["height_cm"],
        "background_image_url": plan["background_image_url"],
        "scene": {"version": 4, "floors": plan["scene"]["floors"]},
        "workspaces": [{k: v for k, v in w.items() if k != "id"} for w in plan["workspaces"]],
    }


def test_anonymous_cannot_read_or_write_plans(client: TestClient) -> None:
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/1").status_code == 401


def test_every_role_can_view_but_only_admin_can_edit(client: TestClient) -> None:
    admin = login(client, "admin")
    payload = _plan_payload(client, admin)
    for user_login in ("sysadmin", "head", "depthead", "employee"):
        headers = login(client, user_login)
        assert client.get(URL, headers=headers).status_code == 200, user_login
        assert client.get(f"{URL}/1", headers=headers).status_code == 200, user_login
        assert client.put(f"{URL}/1", json=payload, headers=headers).status_code == 403, user_login
        assert client.post(URL, json=payload, headers=headers).status_code == 403, user_login
        assert client.patch(f"{URL}/1", json={"name": "X"}, headers=headers).status_code == 403, user_login
        assert client.delete(f"{URL}/1", headers=headers).status_code == 403, user_login
    assert client.put(f"{URL}/1", json=payload, headers=admin).status_code == 200
