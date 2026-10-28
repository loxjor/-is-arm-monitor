#!/usr/bin/env bash
# Выполняется на сервере после выкладки файлов: зависимости, миграции, перезапуск API.
set -euo pipefail
cd /opt/arm-monitor

[ -f backend/.env ] || { echo "нет backend/.env — см. deploy/README.md" >&2; exit 1; }

[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r backend/requirements.txt

(cd backend && ../.venv/bin/alembic upgrade head)

sudo systemctl restart arm-monitor
sleep 2
curl -fsS http://127.0.0.1:8000/health >/dev/null
echo "deploy ok"
