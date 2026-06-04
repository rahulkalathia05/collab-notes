import uuid
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.schemas.note import (
    NoteCreate,
    NoteListItem,
    NoteResponse,
    NoteUpdate,
    NoteVersionCreate,
    NoteVersionResponse,
    NoteVersionUpdate,
)
from app.services.note_service import NoteService

router = APIRouter(prefix="/workspaces/{workspace_id}/notes", tags=["notes"])


async def _bg_embed(note_id: uuid.UUID) -> None:
    """Background task: embed a note in its own session after the request commits."""
    from app.services.embedding_service import EmbeddingService
    async with AsyncSessionLocal() as session:
        try:
            await EmbeddingService(session).embed_note(note_id)
            await session.commit()
        except Exception:
            await session.rollback()


# ── collection ────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[NoteListItem])
async def list_notes(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).get_all(workspace_id, current_user)


@router.post("/", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    workspace_id: UUID,
    body: NoteCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    note = await NoteService(db).create(workspace_id, body, current_user)
    background_tasks.add_task(_bg_embed, note.id)
    return note


# ── single resource ───────────────────────────────────────────────────────────

@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    workspace_id: UUID,
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).get(workspace_id, note_id, current_user)


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    workspace_id: UUID,
    note_id: UUID,
    body: NoteUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    note = await NoteService(db).update(workspace_id, note_id, body, current_user)
    # Only re-embed when content actually changed (title or body)
    if body.title is not None or body.content is not None:
        background_tasks.add_task(_bg_embed, note.id)
    return note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    workspace_id: UUID,
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await NoteService(db).delete(workspace_id, note_id, current_user)


@router.post("/{note_id}/pin", response_model=NoteResponse)
async def pin_note(
    workspace_id: UUID,
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).pin(workspace_id, note_id, current_user)


# ── version history ───────────────────────────────────────────────────────────

@router.get("/{note_id}/versions", response_model=list[NoteVersionResponse])
async def list_versions(
    workspace_id: UUID,
    note_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).list_versions(workspace_id, note_id, current_user)


@router.post("/{note_id}/versions", response_model=NoteVersionResponse, status_code=status.HTTP_201_CREATED)
async def create_version(
    workspace_id: UUID,
    note_id: UUID,
    body: NoteVersionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).create_version(workspace_id, note_id, body, current_user)


@router.get("/{note_id}/versions/{version_id}", response_model=NoteVersionResponse)
async def get_version(
    workspace_id: UUID,
    note_id: UUID,
    version_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).get_version(workspace_id, note_id, version_id, current_user)


@router.patch("/{note_id}/versions/{version_id}", response_model=NoteVersionResponse)
async def update_version(
    workspace_id: UUID,
    note_id: UUID,
    version_id: UUID,
    body: NoteVersionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).update_version_label(
        workspace_id, note_id, version_id, body, current_user
    )


@router.delete("/{note_id}/versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(
    workspace_id: UUID,
    note_id: UUID,
    version_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await NoteService(db).delete_version(workspace_id, note_id, version_id, current_user)


@router.post("/{note_id}/versions/{version_id}/restore", response_model=NoteResponse)
async def restore_version(
    workspace_id: UUID,
    note_id: UUID,
    version_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NoteService(db).restore_version(
        workspace_id, note_id, version_id, current_user
    )
