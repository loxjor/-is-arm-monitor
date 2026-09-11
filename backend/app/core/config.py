from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Office Asset Management System"
    # Без пароля в значении по умолчанию — реальный DATABASE_URL приходит
    # из .env (см. .env.example) или переменных окружения, не хардкодится.
    DATABASE_URL: str = "postgresql://localhost:5432/asset_management"
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
