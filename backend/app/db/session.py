from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _engine_options(url: str) -> dict[str, object]:
    if url.startswith("sqlite"):
        # Синхронные роуты FastAPI выполняются в пуле потоков — соединение
        # SQLite может использоваться не тем потоком, что его открыл.
        return {"connect_args": {"check_same_thread": False}}
    # Соединение, оборвавшееся после перезапуска БД или простоя, иначе
    # падает на первом же запросе вместо тихого переподключения.
    return {"pool_pre_ping": True}


engine = create_engine(settings.DATABASE_URL, **_engine_options(settings.DATABASE_URL))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
