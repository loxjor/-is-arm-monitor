from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Office Asset Management System"
    # Без пароля в значении по умолчанию — реальный DATABASE_URL приходит
    # из .env (см. .env.example) или переменных окружения, не хардкодится.
    DATABASE_URL: str = "postgresql://localhost:5432/asset_management"
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
    # Без значения по умолчанию: приложение не стартует без секрета в .env,
    # вместо того чтобы молча подписывать токены общеизвестной строкой.
    JWT_SECRET: str
    JWT_EXPIRE_MINUTES: int = 480
    SEED_PASSWORD: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
