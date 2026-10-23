from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.permissions import ROLE_PERMISSIONS, ROLE_SCOPE, RoleCode
from app.core.security import create_access_token
from app.db.session import get_db
from app.models import AppUser
from app.schemas.auth import CurrentUser, LoginRequest, TokenResponse
from app.schemas.user import UserRead
from app.services import auth_service
from app.services.auth_service import AuthenticationError

router = APIRouter(prefix="/auth", tags=["auth"])


def _current_user(user: AppUser) -> CurrentUser:
    role = RoleCode(user.role.code)
    return CurrentUser(
        **UserRead.model_validate(user).model_dump(),
        permissions=sorted(ROLE_PERMISSIONS[role]),
        scope=ROLE_SCOPE[role],
    )


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    try:
        user = auth_service.authenticate(db, data.login, data.password)
    except AuthenticationError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error))
    return TokenResponse(access_token=create_access_token(user.user_id), user=_current_user(user))


@router.get("/me", response_model=CurrentUser)
def me(user: AppUser = Depends(get_current_user)):
    return _current_user(user)
