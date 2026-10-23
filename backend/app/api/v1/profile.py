from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import AppUser
from app.schemas.profile import Profile
from app.services import profile_service

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=Profile, description="Профиль вошедшего пользователя")
def get_profile(db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    return profile_service.get_profile(db, user)
