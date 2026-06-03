from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note, NoteVersion
from app.repositories.base import BaseRepository


class NoteRepository(BaseRepository[Note]):
    model = Note

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    async def list_by_workspace(self, workspace_id: UUID) -> list[Note]:
        result = await self.session.execute(
            select(Note)
            .where(Note.workspace_id == workspace_id, Note.is_archived.is_(False))
            # Pinned notes surface first, then most-recently-updated
            .order_by(Note.is_pinned.desc(), Note.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get_in_workspace(self, note_id: UUID, workspace_id: UUID) -> Note | None:
        result = await self.session.execute(
            select(Note).where(Note.id == note_id, Note.workspace_id == workspace_id)
        )
        return result.scalar_one_or_none()

    # ── version history ───────────────────────────────────────────────────────

    async def list_versions(self, note_id: UUID, limit: int = 50) -> list[NoteVersion]:
        result = await self.session.execute(
            select(NoteVersion)
            .where(NoteVersion.note_id == note_id)
            .order_by(NoteVersion.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_version(self, version_id: UUID, note_id: UUID) -> NoteVersion | None:
        result = await self.session.execute(
            select(NoteVersion).where(
                NoteVersion.id == version_id,
                NoteVersion.note_id == note_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_version(self, **kwargs) -> NoteVersion:
        version = NoteVersion(**kwargs)
        self.session.add(version)
        await self.session.flush()
        await self.session.refresh(version)
        return version
