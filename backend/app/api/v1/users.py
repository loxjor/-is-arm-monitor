from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser
from app.schemas.user import RoleRead, UserCreate, UserRead, UserUpdate
from app.services import user_service
from app.services.errors import ConflictError, NotFoundError

router = APIRouter(tags=["users"])

_admin = require(Permission.manage_users)


@router.get("/roles", response_model=list[RoleRead])
def list_roles(db: Session = Depends(get_db), _: AppUser = Depends(_admin)):
    return user_service.list_roles(db)


@router.get("/users", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), _: AppUser = Depends(_admin)):
    return user_service.list_users(db)


@router.get("/users/{user_id}", response_model=UserRead)
def get_user(user_id: int, db: Session = Depends(get_db), _: AppUser = Depends(_admin)):
    try:
        return user_service.get_user(db, user_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreate, db: Session = Depends(get_db), actor: AppUser = Depends(_admin)):
    try:
        return user_service.create_user(db, data, actor_id=actor.user_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: int, data: UserUpdate, db: Session = Depends(get_db), actor: AppUser = Depends(_admin)
):
    try:
        return user_service.update_user(db, user_id, data, actor_id=actor.user_id)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    except ConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
