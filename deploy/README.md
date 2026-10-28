# Выкладка на Ubuntu-сервер

GitHub Actions (`.github/workflows/ci.yml`) на каждый пуш и PR гоняет тесты и сборку;
пуш в `master` после зелёных тестов выкладывает приложение на сервер по SSH.

## Один раз на сервере

```bash
sudo apt install -y python3-venv rsync
sudo adduser --disabled-password deploy
sudo mkdir -p /opt/arm-monitor && sudo chown deploy: /opt/arm-monitor

# PostgreSQL (если базы ещё нет)
sudo -u postgres psql -c "CREATE USER arm WITH PASSWORD '<пароль>';"
sudo -u postgres psql -c "CREATE DATABASE arm OWNER arm;"

# systemd
sudo cp deploy/arm-monitor.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable arm-monitor

# deploy может перезапускать только этот сервис
echo 'deploy ALL=(root) NOPASSWD: /bin/systemctl restart arm-monitor' | sudo tee /etc/sudoers.d/arm-monitor
```

Сайт: nginx работает в контейнере Nginx UI (панель — порт 81, сайты — 80/443).
Контейнер запускается с `--add-host host.docker.internal:host-gateway` и
`-v /opt/arm-monitor/www:/opt/arm-monitor/www:ro`; в панели Sites → Add Site
вставить `deploy/nginx.conf` с вашим доменом, сертификат — кнопкой Let's Encrypt.
API слушает 0.0.0.0:8000, чтобы до него достал контейнер, — закройте 8000
снаружи на роутере или `ufw`.

`/opt/arm-monitor/backend/.env` (создаётся вручную, в git не попадает; выкладка его не трогает):

```
DATABASE_URL=postgresql://arm:<пароль>@localhost:5432/arm
JWT_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(48))">
CORS_ORIGINS=["https://<домен>"]
```

Демо-данные (только при первом запуске): `cd /opt/arm-monitor/backend && ../.venv/bin/python -m app.seed`.

## Агент GitHub Actions на сервере

Выкладку выполняет self-hosted runner под пользователем `deploy` с меткой
`arm-monitor`: репозиторий → Settings → Actions → Runners → New self-hosted runner
(Linux x64), команды оттуда выполнить под `deploy`, при `./config.sh` добавить
`--labels arm-monitor`, затем `sudo ./svc.sh install deploy && sudo ./svc.sh start`.
