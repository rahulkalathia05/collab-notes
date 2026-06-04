import re
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import CacheClient
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.repositories.workspace_repository import WorkspaceRepository
from app.repositories.user_repository import UserRepository
from app.schemas.workspace import (
    InviteMemberRequest,
    PaginatedWorkspaces,
    UpdateMemberRoleRequest,
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
        self.cache = CacheClient()

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
        # List is user+filter specific — not cached (too many variations)
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
        response = _to_response(ws, "owner", 1)
        # Warm workspace + role caches immediately
        await self.cache.set_workspace(ws.id, owner.id, response.model_dump(mode="json"))
        await self.cache.set_membership_role(ws.id, owner.id, "owner")
        return response

    async def get(self, workspace_id: UUID, user_id: UUID) -> WorkspaceResponse:
        # Check workspace response cache (per-user because response includes role)
        cached = await self.cache.get_workspace(workspace_id, user_id)
        if cached is not None:
            return WorkspaceResponse.model_validate(cached)

        m = await self._require_membership(workspace_id, user_id)
        count = await self.repo.count_members(workspace_id)
        response = _to_response(m.workspace, m.role, count)

        # Warm both workspace and role caches
        await self.cache.set_workspace(workspace_id, user_id, response.model_dump(mode="json"))
        await self.cache.set_membership_role(workspace_id, user_id, m.role)
        return response

    async def update(
        self, workspace_id: UUID, data: WorkspaceUpdate, user: User
    ) -> WorkspaceResponse:
        m = await self._require_membership(workspace_id, user.id, roles=_ADMIN_ROLES)
        ws = m.workspace

        if data.name is not None:
            ws.name = data.name
        if data.icon is not None:
            ws.icon = data.icon

        ws = await self.repo.save(ws)
        count = await self.repo.count_members(workspace_id)
        response = _to_response(ws, m.role, count)

        # Metadata changed — bust all per-user workspace views
        await self.cache.del_workspace_all(workspace_id)
        return response

    async def delete(self, workspace_id: UUID, user: User) -> None:
        m = await self._require_membership(workspace_id, user.id, roles={"owner"})
        await self.repo.delete(m.workspace)
        await self.cache.del_workspace_all(workspace_id)
        await self.cache.del_members(workspace_id)

    # ── members ───────────────────────────────────────────────────────────────

    async def list_members(
        self, workspace_id: UUID, requester: User
    ) -> list[WorkspaceMemberResponse]:
        await self._require_membership(workspace_id, requester.id)

        cached = await self.cache.get_members(workspace_id)
        if cached is not None:
            return [WorkspaceMemberResponse.model_validate(m) for m in cached]

        members = await self.repo.list_members(workspace_id)
        result = [WorkspaceMemberResponse.model_validate(m) for m in members]
        await self.cache.set_members(
            workspace_id, [r.model_dump(mode="json") for r in result]
        )
        return result

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
        members = await self.repo.list_members(workspace_id)
        fresh = next((m for m in members if m.user_id == invitee.id), None)
        response = WorkspaceMemberResponse.model_validate(fresh or member)

        # New member → members list stale; warm invitee role cache
        await self.cache.del_members(workspace_id)
        await self.cache.set_membership_role(workspace_id, invitee.id, data.role)
        return response

    async def update_member_role(
        self,
        workspace_id: UUID,
        target_user_id: UUID,
        data: UpdateMemberRoleRequest,
        requester: User,
    ) -> WorkspaceMemberResponse:
        requester_m = await self._require_membership(workspace_id, requester.id, roles=_ADMIN_ROLES)

        target_m = await self.repo.get_membership(workspace_id, target_user_id)
        if not target_m:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

        if target_m.role == "owner":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot change the workspace owner's role")

        if requester_m.role == "admin" and data.role not in ("editor", "viewer"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins can only assign editor or viewer roles")

        updated = await self.repo.update_member_role(workspace_id, target_user_id, data.role)
        if not updated:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

        members = await self.repo.list_members(workspace_id)
        fresh = next((m for m in members if m.user_id == target_user_id), updated)
        response = WorkspaceMemberResponse.model_validate(fresh)

        # Role changed — invalidate all membership-related caches for this user
        await self.cache.invalidate_membership(workspace_id, target_user_id)
        await self.cache.del_members(workspace_id)
        return response

    async def revoke_member(
        self, workspace_id: UUID, target_user_id: UUID, requester: User
    ) -> None:
        requester_m = await self._require_membership(workspace_id, requester.id, roles=_ADMIN_ROLES)

        target_m = await self.repo.get_membership(workspace_id, target_user_id)
        if not target_m:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

        if target_m.role == "owner":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot remove the workspace owner")

        if requester_m.role == "admin" and target_m.role == "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins cannot remove other admins")

        removed = await self.repo.remove_member(workspace_id, target_user_id)
        if not removed:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

        # Revoked user loses all cached access — purge everything
        await self.cache.invalidate_membership(workspace_id, target_user_id)
        await self.cache.del_members(workspace_id)

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
        # Opportunistically warm the role cache
        await self.cache.set_membership_role(workspace_id, user_id, m.role)
        return m
