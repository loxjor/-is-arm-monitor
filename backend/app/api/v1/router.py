from fastapi import APIRouter

from app.api.v1.floor_plans import router as floor_plans_router

router = APIRouter(prefix="/api/v1")
router.include_router(floor_plans_router)
