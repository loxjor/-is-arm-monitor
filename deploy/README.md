# Выкладка на Ubuntu-сервер

GitHub Actions (`.github/workflows/ci.yml`) на каждый пуш и PR гоняет тесты и сборку;
пуш в `master` после зелёных тестов выкладывает приложение на сервер по SSH.

## Один раз на сервере

```bash
sudo apt install -y nginx python3-venv rsync certbot python3-certbot-nginx
sudo adduser --disabled-password deploy
sudo mkdir -p /opt/arm-monitor && sudo chown deploy: /opt/arm-monitor

# PostgreSQL (если базы ещё нет)
sudo -u postgres psql -c "CREATE USER arm WITH PASSWORD '<пароль>';"
sudo -u postgres psql -c "CREATE DATABASE arm OWNER arm;"

# systemd и nginx
sudo cp deploy/arm-monitor.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable arm-monitor
sudo cp deploy/nginx.conf /etc/nginx/sites-available/arm-monitor   # поправить server_name
sudo ln -s /etc/nginx/sites-available/arm-monitor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <домен>                                     # HTTPS

# deploy может перезапускать только этот сервис
echo 'deploy ALL=(root) NOPASSWD: /bin/systemctl restart arm-monitor' | sudo tee /etc/sudoers.d/arm-monitor
```

`/opt/arm-monitor/backend/.env` (создаётся вручную, в git не попадает; выкладка его не трогает):

```
DATABASE_URL=postgresql://arm:<пароль>@localhost:5432/arm
JWT_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(48))">
CORS_ORIGINS=["https://<домен>"]
```

Демо-данные (только при первом запуске): `cd /opt/arm-monitor/backend && ../.venv/bin/python -m app.seed`.

## Секреты GitHub (Settings → Secrets and variables → Actions)

| Секрет | Значение |
|---|---|
| `DEPLOY_HOST` | адрес сервера |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | приватный ключ (`ssh-keygen -t ed25519`), публичный — в `~deploy/.ssh/authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan <адрес сервера>` |
