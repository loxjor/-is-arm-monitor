from fastapi import APIRouter

router = APIRouter(prefix="/api/v1")

# Роуты для FloorPlan / Workspace подключаются сюда по мере реализации,
# например: router.include_router(workspaces_router)
