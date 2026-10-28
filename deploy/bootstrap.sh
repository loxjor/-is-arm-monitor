#!/usr/bin/env bash
# Разовая настройка сервера от root. Идемпотентен: повторный запуск ничего не ломает.
#   sudo DB_PASSWORD='...' CORS_DOMAIN=dev.b3nyk.org bash deploy/bootstrap.sh
set -euo pipefail

: "${DB_PASSWORD:?задайте DB_PASSWORD}"
CORS_DOMAIN="${CORS_DOMAIN:-dev.b3nyk.org}"
APP=/opt/arm-monitor
REPO="$(cd "$(dirname "$0")/.." && pwd)"

id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy

# База: пользователь и БД, если их ещё нет
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='arm'" | grep -q 1 \
  || sudo -u postgres psql -q -c "CREATE USER arm WITH PASSWORD '${DB_PASSWORD}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='arm'" | grep -q 1 \
  || sudo -u postgres psql -q -c "CREATE DATABASE arm OWNER arm;"

# Папки приложения принадлежат deploy: выкладка и venv пишутся от него
mkdir -p "$APP/backend" "$APP/www"
chown -R deploy:deploy "$APP"

# Настройки бэкенда — только на сервере, выкладка их не трогает
if [ ! -f "$APP/backend/.env" ]; then
  JWT=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  install -m 600 -o deploy -g deploy /dev/null "$APP/backend/.env"
  cat > "$APP/backend/.env" <<EOT
DATABASE_URL=postgresql://arm:${DB_PASSWORD}@localhost:5432/arm
JWT_SECRET=${JWT}
CORS_ORIGINS=["https://${CORS_DOMAIN}"]
EOT
  chown deploy:deploy "$APP/backend/.env"
fi

# Сервис API и право deploy перезапускать только его
install -m 644 "$REPO/deploy/arm-monitor.service" /etc/systemd/system/arm-monitor.service
systemctl daemon-reload
systemctl enable arm-monitor
echo 'deploy ALL=(root) NOPASSWD: /bin/systemctl restart arm-monitor' > /etc/sudoers.d/arm-monitor
chmod 440 /etc/sudoers.d/arm-monitor
visudo -cf /etc/sudoers.d/arm-monitor

echo "bootstrap ok"
