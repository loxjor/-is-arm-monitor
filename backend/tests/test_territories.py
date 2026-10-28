import json
import urllib.error
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.services import geocoder
from tests.conftest import login

URL = "/api/v1/territories"


def test_seeded_building_is_a_territory_with_its_plan(client: TestClient) -> None:
    territories = client.get(URL, headers=login(client, "employee")).json()
    [main] = [t for t in territories if t["name"] == "Главное здание"]
    assert main["latitude"] is not None and main["longitude"] is not None
    assert main["plan"]["workspace_count"] == 6
    # Схема называется как территория.
    assert client.get(f"/api/v1/floor-plans/{main['plan']['id']}", headers=login(client, "employee")).json()["name"] == "Главное здание"


def test_only_editor_creates_and_moves_territories(client: TestClient) -> None:
    body = {"name": "Филиал", "address": "г. Москва, ул. Тестовая, 1", "latitude": 55.7, "longitude": 37.5}
    for user_login in ("sysadmin", "head", "depthead", "employee"):
        headers = login(client, user_login)
        assert client.post(URL, json=body, headers=headers).status_code == 403, user_login
        assert client.patch(f"{URL}/1", json={"name": "X"}, headers=headers).status_code == 403, user_login

    admin = login(client, "admin")
    created = client.post(URL, json=body, headers=admin)
    assert created.status_code == 201
    building_id = created.json()["building_id"]
    moved = client.patch(f"{URL}/{building_id}", json={"latitude": 55.8, "longitude": 37.4}, headers=admin).json()
    assert (moved["latitude"], moved["longitude"], moved["name"]) == (55.8, 37.4, "Филиал")


def test_coordinates_go_in_pairs_and_in_range(client: TestClient) -> None:
    admin = login(client, "admin")
    base = {"name": "Филиал", "address": "г. Москва"}
    assert client.post(URL, json={**base, "latitude": 55.7}, headers=admin).status_code == 422
    assert client.post(URL, json={**base, "latitude": 95, "longitude": 37}, headers=admin).status_code == 422
    assert client.patch(f"{URL}/1", json={"longitude": 37.0}, headers=admin).status_code == 422
    # Без точки — можно: такое здание просто не попадает на карту.
    assert client.post(URL, json=base, headers=admin).status_code == 201
    # Снять точку — обе координаты null.
    cleared = client.patch(f"{URL}/1", json={"latitude": None, "longitude": None}, headers=admin).json()
    assert cleared["latitude"] is None and cleared["longitude"] is None
    assert client.patch(f"{URL}/999", json={"name": "X"}, headers=admin).status_code == 404


def test_territory_outside_region_is_rejected(client: TestClient) -> None:
    admin = login(client, "admin")
    # Санкт-Петербург — за пределами Москвы и области.
    spb = {"name": "Филиал", "address": "Санкт-Петербург", "latitude": 59.94, "longitude": 30.31}
    assert client.post(URL, json=spb, headers=admin).status_code == 422
    assert client.patch(f"{URL}/1", json={"latitude": 59.94, "longitude": 30.31}, headers=admin).status_code == 422
    zelenograd = {**spb, "address": "Зеленоград", "latitude": 55.98, "longitude": 37.18}
    assert client.post(URL, json=zelenograd, headers=admin).status_code == 201


def test_map_config_comes_from_settings(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "MAP_TILE_URL", "http://tiles.local/{z}/{x}/{y}.png")
    monkeypatch.setattr(settings, "GEOCODER_URL", "")
    config = client.get("/api/v1/map/config", headers=login(client, "employee")).json()
    assert config["tile_url"] == "http://tiles.local/{z}/{x}/{y}.png"
    assert config["geocoder"] is False
    assert config["bounds"] == list(settings.MAP_BOUNDS)


class _Response:
    def __init__(self, payload: Any) -> None:
        self.payload = json.dumps(payload).encode()

    def read(self, *_: Any) -> bytes:
        return self.payload

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_: Any) -> None:
        return None


NOMINATIM_HOUSE = {
    "lat": "55.7699",
    "lon": "37.6532",
    "display_name": "3А, Орликов переулок, Красносельский район, Москва, 107078, Россия",
    "address": {"house_number": "3А", "road": "Орликов переулок", "city": "Москва", "postcode": "107078"},
}


def test_geocode_search_and_reverse(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    requested: list[str] = []

    # Та же улица куском с тем же адресом и дом за пределами региона — в ответ не попадают.
    street_piece = {**NOMINATIM_HOUSE, "lat": "55.7701"}
    outside = {**NOMINATIM_HOUSE, "lat": "59.94", "lon": "30.31", "address": {"road": "Невский проспект", "city": "Санкт-Петербург"}}

    def fake_urlopen(request: Any, timeout: float) -> _Response:
        requested.append(request.full_url)
        assert "ARM-Monitor" in request.get_header("User-agent")
        found = [NOMINATIM_HOUSE, street_piece, outside]
        return _Response(found if "/search?" in request.full_url else NOMINATIM_HOUSE)

    monkeypatch.setattr(settings, "GEOCODER_URL", "http://nominatim.local/")
    monkeypatch.setattr(geocoder.urllib.request, "urlopen", fake_urlopen)
    admin = login(client, "admin")

    found = client.get("/api/v1/geocode/search", params={"q": "Орликов 3"}, headers=admin).json()
    assert found == [{"address": "Москва, Орликов переулок, 3А", "latitude": 55.7699, "longitude": 37.6532}]
    assert requested[0].startswith("http://nominatim.local/search?") and "countrycodes=ru" in requested[0]
    assert "bounded=1" in requested[0] and "viewbox=" in requested[0]

    # Точка за пределами региона — без запроса к геокодеру.
    outside_point = client.get("/api/v1/geocode/reverse", params={"lat": 59.94, "lon": 30.31}, headers=admin)
    assert outside_point.status_code == 200 and outside_point.json() is None
    assert len(requested) == 1

    # Точка остаётся там, где её поставили, адрес — дома под ней.
    reverse = client.get("/api/v1/geocode/reverse", params={"lat": 55.77, "lon": 37.65}, headers=admin).json()
    assert reverse == {"address": "Москва, Орликов переулок, 3А", "latitude": 55.77, "longitude": 37.65}

    employee = login(client, "employee")
    assert client.get("/api/v1/geocode/search", params={"q": "Орликов"}, headers=employee).status_code == 403


def test_geocoder_down_or_disabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*_: Any, **__: Any) -> None:
        raise urllib.error.URLError("нет сети")

    monkeypatch.setattr(settings, "GEOCODER_URL", "http://nominatim.local")
    monkeypatch.setattr(geocoder.urllib.request, "urlopen", broken)
    admin = login(client, "admin")
    assert client.get("/api/v1/geocode/search", params={"q": "Орликов"}, headers=admin).status_code == 503

    monkeypatch.setattr(settings, "GEOCODER_URL", "")
    assert client.get("/api/v1/geocode/search", params={"q": "Орликов"}, headers=admin).status_code == 404
