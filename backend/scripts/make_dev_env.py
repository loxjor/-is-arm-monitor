"""Создаёт backend/.env для локального запуска (вызывается из start.bat).

База — SQLite-файл рядом с backend, секрет JWT и пароль демо-пользователей —
случайные. Существующий .env не трогает.
"""

import secrets
import sys
from pathlib import Path

env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    sys.exit(0)

password = secrets.token_urlsafe(9)
env_path.write_text(
    "DATABASE_URL=sqlite:///./dev.db\n"
    'CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173"]\n'
    f"JWT_SECRET={secrets.token_urlsafe(48)}\n"
    "JWT_EXPIRE_MINUTES=480\n"
    f"SEED_PASSWORD={password}\n",
    encoding="utf-8",
)
print(f"Создан {env_path}")
print(f"Пароль демо-пользователей (admin, sysadmin, head, depthead, employee): {password}")
print("Он сохранён в backend\\.env, строка SEED_PASSWORD.")
