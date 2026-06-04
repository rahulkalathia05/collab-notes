from uuid import UUID
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, joinedload

from app.models.workspace import Workspace, WorkspaceMember
from app.repositories.base import BaseRepository


class WorkspaceRepository(BaseRepository[Workspace]):
    model = Workspace

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    # ── list with filtering + pagination ──────────────────────────────────────

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        search: str | None,
        role: str | None,
        skip: int,
        limit: int,
    ) -> tuple[list[tuple[WorkspaceMember, int]], int]:
        """
        Returns ([(membership, member_count)], total_matching).
        Uses 3 queries regardless of page size:
          1. COUNT for pagination metadata
          2. Paginated SELECT with contains_eager (no N+1 for workspace data)
          3. Batch COUNT for member counts of returned workspaces
        """
        filters = self._base_filters(user_id, search, role)

        # Total count — shares the same filters as the page query
        total: int = await self.session.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .join(Workspace, WorkspaceMember.workspace_id == Workspace.id)
            .where(*filters)
        ) or 0

        if total == 0:
            return [], 0

        # Paginated memberships — workspace loaded via JOIN, no extra queries
        page_stmt = (
            select(WorkspaceMember)
            .join(Workspace, WorkspaceMember.workspace_id == Workspace.id)
            .where(*filters)
            .options(contains_eager(WorkspaceMember.workspace))
            .order_by(WorkspaceMember.joined_at.desc())
            .offset(skip)
            .limit(limit)
        )
        memberships = list((await self.session.execute(page_stmt)).scalars().unique().all())

        # Batch member counts — one query for all returned workspaces
        ws_ids = [m.workspace_id for m in memberships]
        count_rows = await self.session.execute(
            select(WorkspaceMember.workspace_id, func.count().label("cnt"))
            .where(WorkspaceMember.workspace_id.in_(ws_ids))
            .group_by(WorkspaceMember.workspace_id)
        )
        counts: dict[UUID, int] = {row.workspace_id: row.cnt for row in count_rows}

        return [(m, counts.get(m.workspace_id, 0)) for m in memberships], total

    # ── single workspace ops ──────────────────────────────────────────────────

    async def get_membership(self, workspace_id: UUID, user_id: UUID) -> WorkspaceMember | None:
        result = await self.session.execute(
            select(WorkspaceMember)
            .join(Workspace, WorkspaceMember.workspace_id == Workspace.id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
            .options(contains_eager(WorkspaceMember.workspace))
        )
        return result.scalars().unique().one_or_none()

    async def count_members(self, workspace_id: UUID) -> int:
        """Single SELECT COUNT — avoids loading all member rows just to call len()."""
        return await self.session.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id)
        ) or 0

    async def add_member(self, workspace_id: UUID, user_id: UUID, role: str) -> WorkspaceMember:
        member = WorkspaceMember(workspace_id=workspace_id, user_id=user_id, role=role)
        self.session.add(member)
        await self.session.flush()
        return member

    async def list_members(self, workspace_id: UUID) -> list[WorkspaceMember]:
        """Return all members of a workspace with user eagerly loaded."""
        result = await self.session.execute(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id)
            .options(joinedload(WorkspaceMember.user))
            .order_by(WorkspaceMember.joined_at.asc())
        )
        return list(result.unique().scalars().all())

    async def update_member_role(
        self, workspace_id: UUID, user_id: UUID, role: str
    ) -> WorkspaceMember | None:
        member = await self.session.get(
            WorkspaceMember, {"workspace_id": workspace_id, "user_id": user_id}
        )
        if not member:
            return None
        member.role = role
        await self.session.flush()
        await self.session.refresh(member)
        return member

    async def remove_member(self, workspace_id: UUID, user_id: UUID) -> bool:
        member = await self.session.get(
            WorkspaceMember, {"workspace_id": workspace_id, "user_id": user_id}
        )
        if not member:
            return False
        await self.session.delete(member)
        await self.session.flush()
        return True

    async def unique_slug(self, base: str) -> str:
        slug, i = base, 1
        while True:
            exists = await self.session.scalar(
                select(Workspace.id).where(Workspace.slug == slug)
            )
            if not exists:
                return slug
            slug = f"{base}-{i}"
            i += 1

    # ── private ───────────────────────────────────────────────────────────────

    @staticmethod
    def _base_filters(user_id: UUID, search: str | None, role: str | None) -> list:
        filters: list = [WorkspaceMember.user_id == user_id]
        if search:
            filters.append(Workspace.name.ilike(f"%{search}%"))
        if role:
            filters.append(WorkspaceMember.role == role)
        return filters
