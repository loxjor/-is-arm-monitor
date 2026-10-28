from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Office Asset Management System"
    # Без значения по умолчанию: без .env (см. .env.example) или переменной
    # окружения приложение должно упасть при старте, а не молча пойти в
    # чужую базу.
    DATABASE_URL: str
    # localhost и 127.0.0.1 — разные origin для браузера, а Vite слушает оба.
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Без значения по умолчанию: приложение не стартует без секрета в .env,
    # вместо того чтобы молча подписывать токены общеизвестной строкой.
    JWT_SECRET: str
    JWT_EXPIRE_MINUTES: int = 480
    SEED_PASSWORD: str | None = None
    # Стоимость bcrypt. Понижать только в тестах (conftest) — там каждый вход
    # хеширует/проверяет пароль, и 12 раундов занимают основную часть прогона.
    BCRYPT_ROUNDS: int = 12
    # Тело одного PUT/POST — весь план целиком; несколько мегабайт — с
    # большим запасом для тысяч стен и мест, но не безлимит.
    MAX_REQUEST_BODY_BYTES: int = 5_000_000
    # Карта территорий (OpenStreetMap). По умолчанию — публичные серверы OSM;
    # в закрытой сети указываются свой сервер тайлов и свой Nominatim.
    MAP_TILE_URL: str = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    MAP_TILE_ATTRIBUTION: str = "© участники OpenStreetMap"
    MAP_MAX_ZOOM: int = 19
    # Регион карты — Москва и Московская область (запад, юг, восток, север; WGS 84):
    # за его пределы карта не прокручивается, тайлы оттуда не грузятся, адрес там
    # не ищется и территорию не поставить.
    MAP_BOUNDS: tuple[float, float, float, float] = (35.1, 54.2, 40.25, 57.0)
    # Центр карты, пока не выбрана территория, — Москва.
    MAP_CENTER_LAT: float = 55.7558
    MAP_CENTER_LON: float = 37.6173
    MAP_DEFAULT_ZOOM: int = 10
    # Пусто — поиск адреса выключен, территории ставятся только кликом по карте.
    GEOCODER_URL: str = "https://nominatim.openstreetmap.org"
    GEOCODER_COUNTRY_CODES: str = "ru"
    GEOCODER_TIMEOUT_SECONDS: float = 5.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
