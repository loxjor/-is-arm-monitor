@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8

echo === АРМ-Монитор: локальный запуск ===
echo.

where python >nul 2>nul || (echo [ошибка] Не найден Python 3.12+ - установите его и добавьте в PATH. & pause & exit /b 1)
where npm >nul 2>nul || (echo [ошибка] Не найден Node.js - установите его и добавьте в PATH. & pause & exit /b 1)

echo [1/5] Зависимости backend...
python -c "import fastapi, sqlalchemy, alembic, jwt, bcrypt, pydantic_settings" 2>nul || python -m pip install -r backend\requirements.txt || (echo [ошибка] pip install не удался. & pause & exit /b 1)

echo [2/5] Настройки backend\.env...
python backend\scripts\make_dev_env.py || (echo [ошибка] Не удалось создать backend\.env. & pause & exit /b 1)

echo [3/5] База данных: миграции и демо-данные...
pushd backend
python -m alembic upgrade head || (popd & echo [ошибка] Миграции не применились. & pause & exit /b 1)
python -m app.seed || (popd & echo [ошибка] Демо-данные не загрузились. & pause & exit /b 1)
popd

echo [4/5] Зависимости frontend...
if not exist frontend\node_modules (
  pushd frontend
  call npm install || (popd & echo [ошибка] npm install не удался. & pause & exit /b 1)
  popd
)

echo [5/5] Запуск серверов в отдельных окнах...
start "АРМ-Монитор backend :8000" /D "%~dp0backend" cmd /k python -m uvicorn app.main:app --port 8000 --reload
start "АРМ-Монитор frontend :5173" /D "%~dp0frontend" cmd /k npm run dev

timeout /t 5 /nobreak >nul
start "" "http://localhost:5173/admin.html"

echo.
echo Готово. Сайт: http://localhost:5173/admin.html
echo Логины: admin, sysadmin, head, depthead, employee
echo Пароль: строка SEED_PASSWORD в backend\.env
echo Чтобы остановить, закройте окна backend и frontend.
echo.
pause
