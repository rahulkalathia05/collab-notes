from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.workspace import (
    InviteMemberRequest,
    PaginatedWorkspaces,
    WorkspaceCreate,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

_VALID_ROLES = {"owner", "admin", "editor", "viewer"}


class _ListParams:
    """Query-parameter dependency for the workspace list endpoint."""

    def __init__(
        self,
        search: str | None = Query(None, max_length=100, description="Filter by name"),
        role: str | None = Query(None, description="Filter by membership role"),
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ) -> None:
        self.search = search.strip() if search else None
        self.role = role if role in _VALID_ROLES else None
        self.page = page
        self.page_size = page_size
        self.skip = (page - 1) * page_size


# ── collection ────────────────────────────────────────────────────────────────

@router.get("/", response_model=PaginatedWorkspaces)
async def list_workspaces(
    params: _ListParams = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).list_for_user(
        user_id=current_user.id,
        search=params.search,
        role=params.role,
        skip=params.skip,
        limit=params.page_size,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("/", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).create(body, current_user)


# ── single resource ───────────────────────────────────────────────────────────

@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).get(workspace_id, current_user.id)


@router.patch("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: UUID,
    body: WorkspaceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).update(workspace_id, body, current_user)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await WorkspaceService(db).delete(workspace_id, current_user)


# ── members ───────────────────────────────────────────────────────────────────

@router.post(
    "/{workspace_id}/members",
    response_model=WorkspaceMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    workspace_id: UUID,
    body: InviteMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).invite_member(workspace_id, body, current_user)
