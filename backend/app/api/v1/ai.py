from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.repositories.note_repository import NoteRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.ai import SummarizeRequest, WritingAssistRequest
from app.services.ai_service import extract_text_from_tiptap, stream_summarize, stream_writing_assist

router = APIRouter(prefix="/ai", tags=["ai"])


async def _log_ai_event(
    workspace_id: UUID,
    note_id: UUID | None,
    user_id: UUID,
    action: str,
) -> None:
    """Background task: log an AI event for analytics. Never raises."""
    try:
        from app.repositories.analytics_repository import AnalyticsRepository
        async with AsyncSessionLocal() as session:
            await AnalyticsRepository(session).log_ai_event(
                workspace_id, note_id, user_id, action
            )
    except Exception:
        pass  # analytics events are best-effort; never break the main flow


@router.post("/summarize")
async def summarize_note(
    body: SummarizeRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream an AI-generated summary for a note.

    SSE event shapes:
      data: {"text": "..."}                       — incremental token
      data: {"type": "done", "summary": "...",    — terminal; structured result
             "key_points": [...], "action_items": [...]}
      data: {"type": "error", "message": "..."}   — failure
    """
    ws_repo = WorkspaceRepository(db)
    membership = await ws_repo.get_membership(body.workspace_id, current_user.id)
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    note_repo = NoteRepository(db)
    note = await note_repo.get_in_workspace(body.note_id, body.workspace_id)
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")

    text = note.content_text or extract_text_from_tiptap(note.content)

    background_tasks.add_task(
        _log_ai_event, body.workspace_id, body.note_id, current_user.id, "summarize"
    )

    return StreamingResponse(
        stream_summarize(note.title, text),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/writing-assist")
async def writing_assist(
    body: WritingAssistRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream an AI writing-assist transformation for a selected text block.

    Actions: rewrite | improve_writing | grammar_correction | expand_section | shorten_section
    """
    ws_repo = WorkspaceRepository(db)
    membership = await ws_repo.get_membership(body.workspace_id, current_user.id)
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    note_repo = NoteRepository(db)
    note = await note_repo.get_in_workspace(body.note_id, body.workspace_id)
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")

    note_text = note.content_text or extract_text_from_tiptap(note.content)

    background_tasks.add_task(
        _log_ai_event, body.workspace_id, body.note_id, current_user.id, body.action.value
    )

    return StreamingResponse(
        stream_writing_assist(
            action=body.action.value,
            selected_text=body.selected_text,
            context=note_text[:5_000] if note_text else None,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
