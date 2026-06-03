import re
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.repositories.workspace_repository import WorkspaceRepository
from app.repositories.user_repository import UserRepository
from app.schemas.workspace import (
    InviteMemberRequest,
    PaginatedWorkspaces,
    WorkspaceCreate,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)

_ADMIN_ROLES = {"owner", "admin"}


def _slugify(name: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", name.lower().strip())
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug.strip("-")[:60]


def _to_response(ws: Workspace, role: str, member_count: int) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        owner_id=ws.owner_id,
        icon=ws.icon,
        created_at=ws.created_at,
        updated_at=ws.updated_at,
        role=role,
        member_count=member_count,
    )


class WorkspaceService:
    def __init__(self, db: AsyncSession) -> None:
        self.repo = WorkspaceRepository(db)
        self.user_repo = UserRepository(db)

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def list_for_user(
        self,
        user_id: UUID,
        search: str | None,
        role: str | None,
        skip: int,
        limit: int,
        page: int,
        page_size: int,
    ) -> PaginatedWorkspaces:
        items, total = await self.repo.list_for_user(
            user_id, search=search, role=role, skip=skip, limit=limit
        )
        return PaginatedWorkspaces(
            items=[_to_response(m.workspace, m.role, count) for m, count in items],
            total=total,
            page=page,
            page_size=page_size,
            pages=max(1, (total + page_size - 1) // page_size),
        )

    async def create(self, data: WorkspaceCreate, owner: User) -> WorkspaceResponse:
        slug = await self.repo.unique_slug(_slugify(data.name))
        ws = await self.repo.create(
            name=data.name,
            slug=slug,
            owner_id=owner.id,
            icon=data.icon,
        )
        await self.repo.add_member(ws.id, owner.id, "owner")
        return _to_response(ws, "owner", 1)

    async def get(self, workspace_id: UUID, user_id: UUID) -> WorkspaceResponse:
        m = await self._require_membership(workspace_id, user_id)
        count = await self.repo.count_members(workspace_id)
        return _to_response(m.workspace, m.role, count)

    async def update(
        self, workspace_id: UUID, data: WorkspaceUpdate, user: User
    ) -> WorkspaceResponse:
        m = await self._require_membership(workspace_id, user.id, roles=_ADMIN_ROLES)
        ws = m.workspace

        # Explicit field assignment — makes the allowed set obvious
        if data.name is not None:
            ws.name = data.name
        if data.icon is not None:
            ws.icon = data.icon

        ws = await self.repo.save(ws)
        count = await self.repo.count_members(workspace_id)
        return _to_response(ws, m.role, count)

    async def delete(self, workspace_id: UUID, user: User) -> None:
        m = await self._require_membership(workspace_id, user.id, roles={"owner"})
        await self.repo.delete(m.workspace)

    # ── members ───────────────────────────────────────────────────────────────

    async def invite_member(
        self, workspace_id: UUID, data: InviteMemberRequest, requester: User
    ) -> WorkspaceMemberResponse:
        await self._require_membership(workspace_id, requester.id, roles=_ADMIN_ROLES)

        invitee = await self.user_repo.get_by_email(data.email)
        if not invitee:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

        if await self.repo.get_membership(workspace_id, invitee.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "User is already a member")

        member = await self.repo.add_member(workspace_id, invitee.id, data.role)
        return WorkspaceMemberResponse.model_validate(member)

    # ── private ───────────────────────────────────────────────────────────────

    async def _require_membership(
        self,
        workspace_id: UUID,
        user_id: UUID,
        roles: set[str] | None = None,
    ) -> WorkspaceMember:
        m = await self.repo.get_membership(workspace_id, user_id)
        if not m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")
        if roles and m.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return m
