from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.repositories.note_repository import NoteRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.ai import SummarizeRequest, WritingAssistRequest
from app.services.ai_service import extract_text_from_tiptap, stream_summarize, stream_writing_assist

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/summarize")
async def summarize_note(
    body: SummarizeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream an AI-generated summary for a note.

    Returns a Server-Sent Events stream with three event shapes:
      data: {"text": "..."}                       — incremental token
      data: {"type": "done", "summary": "...",    — terminal; structured result
             "key_points": [...], "action_items": [...]}
      data: {"type": "error", "message": "..."}   — failure
    """
    # ── authorization ─────────────────────────────────────────────────────────
    ws_repo = WorkspaceRepository(db)
    membership = await ws_repo.get_membership(body.workspace_id, current_user.id)
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    # ── fetch note ────────────────────────────────────────────────────────────
    note_repo = NoteRepository(db)
    note = await note_repo.get_in_workspace(body.note_id, body.workspace_id)
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")

    # ── extract plain text ────────────────────────────────────────────────────
    # Use content_text if already populated; otherwise extract from TipTap JSON.
    text = note.content_text or extract_text_from_tiptap(note.content)

    return StreamingResponse(
        stream_summarize(note.title, text),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Disable nginx / proxy buffering so tokens reach the client immediately
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/writing-assist")
async def writing_assist(
    body: WritingAssistRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream an AI writing-assist transformation for a selected text block.

    Actions: rewrite | improve_writing | grammar_correction | expand_section | shorten_section

    SSE event shapes:
      data: {"text": "..."}                                  — incremental token
      data: {"type": "done", "action": "...",                — terminal; structured result
             "result": "...", "changes": [...]}
      data: {"type": "error", "message": "..."}              — failure
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
