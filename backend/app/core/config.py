from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Office Asset Management System"
    # Без значения по умолчанию: без .env (см. .env.example) или переменной
    # окружения приложение должно упасть при старте, а не молча пойти в
    # чужую базу.
    DATABASE_URL: str
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
    # Тело одного PUT/POST — весь план целиком; несколько мегабайт — с
    # большим запасом для тысяч стен и мест, но не безлимит.
    MAX_REQUEST_BODY_BYTES: int = 5_000_000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
