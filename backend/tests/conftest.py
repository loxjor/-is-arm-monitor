import os
from collections.abc import Generator

import pytest

# Настройки читаются при импорте app.core.config — переменные окружения
# должны быть выставлены раньше, чем тесты импортируют приложение.
os.environ.setdefault("DATABASE_URL", "sqlite:///./pytest-placeholder.db")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import models  # noqa: E402,F401  — регистрирует таблицы в Base.metadata
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    # In-memory SQLite, одно соединение на тест (StaticPool) — схема из
    # моделей, не из миграций: миграции проверяются отдельно (test_migrations.py).
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
