from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.comment import CommentCreate, CommentResponse, ReplyCreate, ReplyResponse
from app.services.comment_service import CommentService

router = APIRouter(
    prefix="/workspaces/{workspace_id}/notes/{note_id}/comments",
    tags=["comments"],
)


@router.get("/", response_model=list[CommentResponse])
async def list_comments(
    workspace_id: UUID,
    note_id: UUID,
    include_resolved: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CommentService(db).list(workspace_id, note_id, current_user, include_resolved)


@router.post("/", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    workspace_id: UUID,
    note_id: UUID,
    body: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CommentService(db).create(workspace_id, note_id, body, current_user)


@router.post(
    "/{comment_id}/replies",
    response_model=ReplyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reply(
    workspace_id: UUID,
    note_id: UUID,
    comment_id: UUID,
    body: ReplyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CommentService(db).create_reply(
        workspace_id, note_id, comment_id, body, current_user
    )


@router.patch("/{comment_id}/resolve", response_model=CommentResponse)
async def resolve_comment(
    workspace_id: UUID,
    note_id: UUID,
    comment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CommentService(db).toggle_resolve(
        workspace_id, note_id, comment_id, current_user
    )


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    workspace_id: UUID,
    note_id: UUID,
    comment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await CommentService(db).delete(workspace_id, note_id, comment_id, current_user)
