from fastapi import APIRouter

from app.api.v1.audit_log import router as audit_log_router
from app.api.v1.auth import router as auth_router
from app.api.v1.catalogs import router as catalogs_router
from app.api.v1.equipment import router as equipment_router
from app.api.v1.floor_plans import router as floor_plans_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.profile import router as profile_router
from app.api.v1.territories import router as territories_router
from app.api.v1.users import router as users_router

router = APIRouter(prefix="/api/v1")
router.include_router(floor_plans_router)
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(audit_log_router)
router.include_router(catalogs_router)
router.include_router(equipment_router)
router.include_router(inventory_router)
router.include_router(profile_router)
router.include_router(territories_router)
