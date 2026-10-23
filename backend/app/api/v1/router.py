from fastapi import APIRouter

from app.api.v1.audit_log import router as audit_log_router
from app.api.v1.auth import router as auth_router
from app.api.v1.floor_plans import router as floor_plans_router
from app.api.v1.users import router as users_router

router = APIRouter(prefix="/api/v1")
router.include_router(floor_plans_router)
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(audit_log_router)
