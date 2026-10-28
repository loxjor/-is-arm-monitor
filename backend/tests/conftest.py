import os

# До импорта app: Settings читается при импорте, а JWT_SECRET и DATABASE_URL обязательны.
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"
os.environ["SEED_PASSWORD"] = "demo-password-1"
os.environ["DATABASE_URL"] = "sqlite://"
# Минимум bcrypt (4 раунда) — только для скорости тестов; в продукте по умолчанию 12.
os.environ["BCRYPT_ROUNDS"] = "4"

from collections.abc import Generator  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import Engine, create_engine, event  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402, F401  — регистрирует таблицы в Base.metadata
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402

SEED_PASSWORD = os.environ["SEED_PASSWORD"]


def _enable_sqlite_foreign_keys(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def _memory_engine() -> Engine:
    # In-memory SQLite, одно соединение на тест (StaticPool) — иначе каждая
    # сессия видела бы свою пустую базу. Схема из моделей, не из миграций:
    # миграции проверяются отдельно (test_migrations.py).
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def db() -> Generator[Session, None, None]:
    """База с демо-данными учётной части (app.seed) — для тестов АРМ-Монитора."""
    engine = _memory_engine()
    session_factory = sessionmaker(bind=engine, autoflush=False)
    with session_factory() as session:
        seed(session)
    with session_factory() as session:
        yield session
    engine.dispose()


@pytest.fixture
def client(db: Session) -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Пустая база — для тестов редактора карты, которым демо-план мешал бы."""
    engine = _memory_engine()
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def empty_client(db_session: Session) -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def login(client: TestClient, user_login: str, password: str = SEED_PASSWORD) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"login": user_login, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
