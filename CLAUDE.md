# CLAUDE.md

Дипломный проект: интерактивная информационная система управления активами для
отслеживания рабочих мест в офисе через визуальные планы этажей (floor plans).
Пользователь видит план этажа, на нём — рабочие места (столы), может кликать
по ним, перемещать, менять размер/поворот и назначать статус (свободно /
занято / забронировано).

## Стек

- **Frontend**: TypeScript + [Konva.js](https://konvajs.org/) (2D canvas),
  сборка через Vite. Без UI-фреймворка — компоненты сцены реализованы как
  обычные TS-классы, оборачивающие узлы Konva.
- **Backend**: Python + FastAPI, SQLAlchemy (ORM) + Alembic (миграции).
- **База данных**: PostgreSQL.

## Структура проекта

```
diplom_program/
├── frontend/                  # клиентское приложение (Vite + TS + Konva)
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.ts            # точка входа, инициализация сцены
│       ├── styles.css
│       ├── types/
│       │   └── workspace.ts   # доменные типы (WorkspaceData, статусы и т.д.)
│       └── components/
│           ├── FloorPlanCanvas.ts  # Stage + слои (фон/основной) + Transformer
│           └── Workspace.ts        # интерактивное рабочее место (Group: Rect+Text)
│
└── backend/                   # серверное приложение (FastAPI)
    ├── requirements.txt
    └── app/
        ├── main.py            # создание FastAPI-приложения, роуты, CORS
        ├── core/
        │   └── config.py      # настройки (pydantic-settings)
        ├── api/
        │   └── v1/
        │       └── router.py  # версионированный роутер API
        ├── db/
        │   ├── base.py        # DeclarativeBase для моделей SQLAlchemy
        │   └── session.py     # engine + SessionLocal
        ├── models/            # ORM-модели (Office, FloorPlan, Workspace, ...)
        ├── schemas/           # Pydantic-схемы запросов/ответов
        └── services/          # бизнес-логика, не завязанная на FastAPI/ORM напрямую
```

## Ключевые доменные сущности (ориентир для моделей и схем)

- **Office / Floor** — офис и этаж, к которому привязан план.
- **FloorPlan** — визуальный план этажа (фоновое изображение + размеры сцены).
- **Workspace** — рабочее место на плане: `x`, `y`, `width`, `height`,
  `rotation`, `label`, `status` (`free` / `occupied` / `reserved`),
  опционально — привязанный сотрудник/актив.

## Конвенции

- Frontend: строгий `tsconfig` (`strict: true`), без `any`. Каждый визуальный
  элемент сцены — отдельный класс, оборачивающий `Konva.Group`/`Konva.Node`, а
  не свободные функции, разбросанные по `main.ts`.
- Один `Konva.Transformer` на сцену, разделяемый между всеми выделяемыми
  объектами (стандартный паттерн Konva) — не создавать Transformer на каждый
  объект отдельно.
- Backend: роуты версионируются через `api/v1`, конфигурация — через
  `pydantic-settings` и `.env` (не хардкодить значения в коде).
- Комментарии — только там, где неочевидна причина решения; не описывать в
  комментариях то, что понятно из кода.

## Запуск (после установки зависимостей)

- Frontend: `cd frontend && npm install && npm run dev`
- Backend: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`
