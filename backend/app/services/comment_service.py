from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Comment
from app.models.user import User
from app.repositories.comment_repository import CommentRepository
from app.repositories.note_repository import NoteRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.comment import CommentCreate, ReplyCreate

_ADMIN_ROLES = {"owner", "admin"}


class CommentService:
    def __init__(self, db: AsyncSession) -> None:
        self.comment_repo = CommentRepository(db)
        self.note_repo = NoteRepository(db)
        self.ws_repo = WorkspaceRepository(db)

    # ── list ──────────────────────────────────────────────────────────────────

    async def list(
        self,
        workspace_id: UUID,
        note_id: UUID,
        user: User,
        include_resolved: bool = True,
    ) -> list[Comment]:
        await self._check_access(workspace_id, user.id)
        await self._get_note_or_404(note_id, workspace_id)
        return await self.comment_repo.list_for_note(note_id, include_resolved)

    # ── create ────────────────────────────────────────────────────────────────

    async def create(
        self, workspace_id: UUID, note_id: UUID, data: CommentCreate, user: User
    ) -> Comment:
        await self._check_access(workspace_id, user.id)
        await self._get_note_or_404(note_id, workspace_id)

        if data.comment_type == "selection" and (
            data.selection_from is None or data.selection_to is None
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "selection_from and selection_to are required for selection comments",
            )

        return await self.comment_repo.create(
            note_id=note_id,
            user_id=user.id,
            content=data.content,
            comment_type=data.comment_type,
            anchor_text=data.anchor_text,
            selection_from=data.selection_from,
            selection_to=data.selection_to,
        )

    # ── reply ─────────────────────────────────────────────────────────────────

    async def create_reply(
        self,
        workspace_id: UUID,
        note_id: UUID,
        comment_id: UUID,
        data: ReplyCreate,
        user: User,
    ) -> Comment:
        await self._check_access(workspace_id, user.id)
        await self._get_note_or_404(note_id, workspace_id)
        parent = await self._get_comment_or_404(comment_id, note_id)
        if parent.parent_id is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot reply to a reply")

        return await self.comment_repo.create(
            note_id=note_id,
            user_id=user.id,
            content=data.content,
            comment_type="note",
            parent_id=parent.id,
        )

    # ── resolve ───────────────────────────────────────────────────────────────

    async def toggle_resolve(
        self, workspace_id: UUID, note_id: UUID, comment_id: UUID, user: User
    ) -> Comment:
        await self._check_access(workspace_id, user.id)
        await self._get_note_or_404(note_id, workspace_id)
        comment = await self._get_comment_or_404(comment_id, note_id)
        if comment.parent_id is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only top-level comments can be resolved")

        comment.resolved = not comment.resolved
        comment.resolved_by = user.id if comment.resolved else None
        return await self.comment_repo.save(comment)

    # ── delete ────────────────────────────────────────────────────────────────

    async def delete(
        self, workspace_id: UUID, note_id: UUID, comment_id: UUID, user: User
    ) -> None:
        m = await self.ws_repo.get_membership(workspace_id, user.id)
        if not m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")
        await self._get_note_or_404(note_id, workspace_id)
        comment = await self._get_comment_or_404(comment_id, note_id)

        if comment.user_id != user.id and m.role not in _ADMIN_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete another user's comment")

        await self.comment_repo.delete(comment)

    # ── private ───────────────────────────────────────────────────────────────

    async def _check_access(self, workspace_id: UUID, user_id: UUID) -> None:
        m = await self.ws_repo.get_membership(workspace_id, user_id)
        if not m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    async def _get_note_or_404(self, note_id: UUID, workspace_id: UUID):
        note = await self.note_repo.get_in_workspace(note_id, workspace_id)
        if not note:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
        return note

    async def _get_comment_or_404(self, comment_id: UUID, note_id: UUID) -> Comment:
        c = await self.comment_repo.get_for_note(comment_id, note_id)
        if not c:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
        return c
