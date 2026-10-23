from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.permissions import Permission
from app.db.session import get_db
from app.models import AppUser, TicketStatus, TicketType
from app.schemas.page import Page
from app.schemas.ticket import TicketCard, TicketCreate, TicketListItem, TicketTransition, TicketWorkCreate
from app.services import ticket_service
from app.services.errors import ConflictError, NotFoundError
from app.services.ticket_service import ForbiddenError, TicketFilters

router = APIRouter(prefix="/tickets", tags=["tickets"])


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, ForbiddenError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    if isinstance(error, ConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))


@router.get("", response_model=Page[TicketListItem])
def list_tickets(
    status_: TicketStatus | None = Query(default=None, alias="status"),
    ticket_type: TicketType | None = None,
    equipment_id: int | None = None,
    assigned_to_me: bool = False,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    filters = TicketFilters(status=status_, ticket_type=ticket_type, equipment_id=equipment_id,
                            assigned_to_me=assigned_to_me, q=q)
    items, total = ticket_service.list_tickets(db, user, filters, limit=limit, offset=offset)
    return Page[TicketListItem](items=items, total=total)


@router.get("/summary", response_model=dict[str, int], description="Количество заявок по статусам")
def summary(db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    return ticket_service.status_counts(db, user)


@router.get("/{ticket_id}", response_model=TicketCard)
def get_ticket(ticket_id: int, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    try:
        return ticket_service.get_card(db, user, ticket_id)
    except NotFoundError as error:
        raise _http_error(error)


@router.post("", response_model=TicketCard, status_code=status.HTTP_201_CREATED)
def create_ticket(
    data: TicketCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require(Permission.create_tickets)),
):
    try:
        return ticket_service.create(db, user, data)
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Оборудование не найдено") from error
    except ConflictError as error:
        raise _http_error(error)


@router.post("/{ticket_id}/transitions", response_model=TicketCard)
def transition(
    ticket_id: int, data: TicketTransition, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)
):
    try:
        return ticket_service.transition(db, user, ticket_id, data)
    except (NotFoundError, ConflictError, ForbiddenError) as error:
        raise _http_error(error)


@router.post("/{ticket_id}/works", response_model=TicketCard, status_code=status.HTTP_201_CREATED)
def add_work(
    ticket_id: int, data: TicketWorkCreate, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)
):
    try:
        return ticket_service.add_work(db, user, ticket_id, data)
    except (NotFoundError, ConflictError, ForbiddenError) as error:
        raise _http_error(error)
