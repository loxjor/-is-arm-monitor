"""
Поиск адреса через Nominatim (геокодер OpenStreetMap). Запросы идут с
бэкенда, а не из браузера: в закрытой сети наружу ходит только сервер, а
адрес геокодера (публичный или свой) задаётся одной настройкой GEOCODER_URL.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.core.config import settings
from app.schemas.territory import GeocodeResult

# Правила публичного Nominatim требуют узнаваемый User-Agent.
USER_AGENT = "ARM-Monitor/1.0 (asset management, internal)"


class GeocoderUnavailable(RuntimeError):
    pass


def enabled() -> bool:
    return bool(settings.GEOCODER_URL)


def in_bounds(latitude: float, longitude: float) -> bool:
    """Точка внутри региона карты (MAP_BOUNDS)."""
    west, south, east, north = settings.MAP_BOUNDS
    return west <= longitude <= east and south <= latitude <= north


def _fetch(path: str, params: dict[str, str]) -> Any:
    query = urllib.parse.urlencode({**params, "format": "jsonv2", "addressdetails": "1", "accept-language": "ru"})
    url = f"{settings.GEOCODER_URL.rstrip('/')}/{path}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=settings.GEOCODER_TIMEOUT_SECONDS) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise GeocoderUnavailable("геокодер недоступен") from error


def short_address(item: dict[str, Any]) -> str:
    """«Москва, Орликов переулок, 3» вместо полного display_name с округом и индексом."""
    address = item.get("address") or {}
    city = address.get("city") or address.get("town") or address.get("village") or address.get("state")
    street = address.get("road") or address.get("pedestrian") or address.get("square")
    if not street:
        return str(item.get("display_name", ""))
    return ", ".join(part for part in (city, street, address.get("house_number")) if part)


def _result(item: dict[str, Any]) -> GeocodeResult:
    return GeocodeResult(address=short_address(item), latitude=float(item["lat"]), longitude=float(item["lon"]))


def search(text: str, limit: int = 5) -> list[GeocodeResult]:
    west, south, east, north = settings.MAP_BOUNDS
    # bounded=1 — искать только внутри региона карты, а не «предпочитать» его.
    params = {"q": text, "limit": str(limit), "viewbox": f"{west},{north},{east},{south}", "bounded": "1"}
    if settings.GEOCODER_COUNTRY_CODES:
        params["countrycodes"] = settings.GEOCODER_COUNTRY_CODES
    results: list[GeocodeResult] = []
    seen: set[str] = set()
    for item in _fetch("search", params):
        result = _result(item)
        # Улица приходит несколькими кусками с одним и тем же адресом — оставляем первый.
        if result.address in seen or not in_bounds(result.latitude, result.longitude):
            continue
        seen.add(result.address)
        results.append(result)
    return results


def reverse(latitude: float, longitude: float) -> GeocodeResult | None:
    if not in_bounds(latitude, longitude):
        return None
    # zoom 18 — уровень дома: адрес того здания, на которое поставили точку.
    item = _fetch("reverse", {"lat": str(latitude), "lon": str(longitude), "zoom": "18"})
    if not isinstance(item, dict) or "lat" not in item:
        return None
    # Точка остаётся там, где её поставили, а не в центре найденного дома.
    return _result(item).model_copy(update={"latitude": latitude, "longitude": longitude})
