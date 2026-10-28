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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
