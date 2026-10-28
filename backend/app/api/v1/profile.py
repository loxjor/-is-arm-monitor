from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import AppUser
from app.schemas.profile import PasswordChange, Profile, ProfileUpdate
from app.services import profile_service
from app.services.errors import ConflictError

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=Profile, description="Профиль вошедшего пользователя")
def get_profile(db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    return profile_service.get_profile(db, user)


@router.put("", response_model=Profile, description="Свои контакты: телефон и e-mail")
def update_profile(data: ProfileUpdate, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    return profile_service.update_profile(db, user, data)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT, description="Смена своего пароля")
def change_password(data: PasswordChange, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    try:
        profile_service.change_password(db, user, data)
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
