from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Comment
from app.repositories.base import BaseRepository


class CommentRepository(BaseRepository[Comment]):
    model = Comment

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    async def list_for_note(
        self,
        note_id: UUID,
        include_resolved: bool = True,
    ) -> list[Comment]:
        """Return top-level comments with their replies eagerly loaded."""
        q = (
            select(Comment)
            .where(Comment.note_id == note_id, Comment.parent_id.is_(None))
            .options(
                joinedload(Comment.user),
                selectinload(Comment.replies).joinedload(Comment.user),
            )
            .order_by(Comment.created_at.asc())
        )
        if not include_resolved:
            q = q.where(Comment.resolved.is_(False))
        result = await self.session.execute(q)
        return list(result.unique().scalars().all())

    async def get_for_note(self, comment_id: UUID, note_id: UUID) -> Comment | None:
        result = await self.session.execute(
            select(Comment)
            .where(Comment.id == comment_id, Comment.note_id == note_id)
            .options(joinedload(Comment.user))
        )
        return result.scalar_one_or_none()

    async def count_open(self, note_id: UUID) -> int:
        from sqlalchemy import func
        result = await self.session.execute(
            select(func.count(Comment.id)).where(
                Comment.note_id == note_id,
                Comment.parent_id.is_(None),
                Comment.resolved.is_(False),
            )
        )
        return result.scalar_one()
