from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note, NoteVersion
from app.models.user import User
from app.repositories.note_repository import NoteRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.note import NoteCreate, NoteUpdate, NoteVersionCreate

# Roles that may create or modify notes (viewers are read-only)
_WRITE_ROLES = {"owner", "admin", "editor"}


class NoteService:
    def __init__(self, db: AsyncSession) -> None:
        self.note_repo = NoteRepository(db)
        self.ws_repo = WorkspaceRepository(db)

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def get_all(self, workspace_id: UUID, user: User) -> list[Note]:
        await self._check_access(workspace_id, user.id)
        return await self.note_repo.list_by_workspace(workspace_id)

    async def create(self, workspace_id: UUID, data: NoteCreate, user: User) -> Note:
        await self._check_write(workspace_id, user.id)
        return await self.note_repo.create(
            workspace_id=workspace_id,
            title=data.title,
            content=data.content,
            created_by=user.id,
        )

    async def get(self, workspace_id: UUID, note_id: UUID, user: User) -> Note:
        await self._check_access(workspace_id, user.id)
        return await self._get_or_404(note_id, workspace_id)

    async def update(
        self, workspace_id: UUID, note_id: UUID, data: NoteUpdate, user: User
    ) -> Note:
        await self._check_write(workspace_id, user.id)
        note = await self._get_or_404(note_id, workspace_id)

        # Explicit assignment — clear about what fields PATCH can touch
        if data.title is not None:
            note.title = data.title
        if data.content is not None:
            note.content = data.content

        note.updated_by = user.id
        return await self.note_repo.save(note)

    async def delete(self, workspace_id: UUID, note_id: UUID, user: User) -> None:
        await self._check_write(workspace_id, user.id)
        note = await self._get_or_404(note_id, workspace_id)
        note.is_archived = True
        await self.note_repo.save(note)

    async def pin(self, workspace_id: UUID, note_id: UUID, user: User) -> Note:
        """Toggles the pin state. Any workspace member may pin."""
        await self._check_access(workspace_id, user.id)
        note = await self._get_or_404(note_id, workspace_id)
        note.is_pinned = not note.is_pinned
        return await self.note_repo.save(note)

    # ── version history ───────────────────────────────────────────────────────

    async def list_versions(
        self, workspace_id: UUID, note_id: UUID, user: User
    ) -> list[NoteVersion]:
        await self._check_access(workspace_id, user.id)
        await self._get_or_404(note_id, workspace_id)
        return await self.note_repo.list_versions(note_id)

    async def create_version(
        self, workspace_id: UUID, note_id: UUID, data: NoteVersionCreate, user: User
    ) -> NoteVersion:
        await self._check_write(workspace_id, user.id)
        note = await self._get_or_404(note_id, workspace_id)
        return await self.note_repo.create_version(
            note_id=note.id,
            content=note.content or {},
            content_text=note.content_text,
            snapshot_by=user.id,
            label=data.label,
        )

    async def restore_version(
        self, workspace_id: UUID, note_id: UUID, version_id: UUID, user: User
    ) -> Note:
        """
        Applies a historical version to the note.
        Snapshots the current state first so the restore is itself undoable.
        """
        await self._check_write(workspace_id, user.id)
        note = await self._get_or_404(note_id, workspace_id)
        version = await self.note_repo.get_version(version_id, note_id)
        if not version:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")

        # Preserve the current state before overwriting
        await self.note_repo.create_version(
            note_id=note.id,
            content=note.content or {},
            content_text=note.content_text,
            snapshot_by=user.id,
            label=f"Before restore to {version.created_at.strftime('%Y-%m-%d %H:%M')}",
        )

        note.content = version.content
        note.content_text = version.content_text
        note.updated_by = user.id
        return await self.note_repo.save(note)

    # ── private ───────────────────────────────────────────────────────────────

    async def _check_access(self, workspace_id: UUID, user_id: UUID) -> None:
        """Read access: any workspace member."""
        m = await self.ws_repo.get_membership(workspace_id, user_id)
        if not m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    async def _check_write(self, workspace_id: UUID, user_id: UUID) -> None:
        """Write access: editor, admin, or owner only."""
        m = await self.ws_repo.get_membership(workspace_id, user_id)
        if not m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")
        if m.role not in _WRITE_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers cannot modify notes")

    async def _get_or_404(self, note_id: UUID, workspace_id: UUID) -> Note:
        note = await self.note_repo.get_in_workspace(note_id, workspace_id)
        if not note:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
        return note
