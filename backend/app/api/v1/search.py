from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.search import ReindexResponse, SearchResponse, SearchMode
from app.services.search_service import SearchService

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/", response_model=SearchResponse)
async def search_notes(
    q: str = Query(..., min_length=2, max_length=200),
    mode: SearchMode = Query("keyword", description="keyword | semantic | hybrid"),
    workspace_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Search notes with three modes:

    - **keyword** — PostgreSQL full-text search (FTS), returns highlighted snippets
    - **semantic** — OpenAI embedding similarity (meaning-based, no keywords needed)
    - **hybrid** — Reciprocal Rank Fusion of FTS + semantic (best overall quality)

    Semantic and hybrid modes require OPENAI_API_KEY to be configured.
    If the key is missing, both modes degrade to keyword automatically.
    """
    return await SearchService(db).search(
        user=current_user,
        query=q,
        page=page,
        page_size=page_size,
        workspace_id=workspace_id,
        mode=mode,
    )


@router.post("/reindex", response_model=ReindexResponse)
async def reindex(
    workspace_id: UUID | None = Query(None, description="Scope reindex to one workspace"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger embedding generation for notes that have no vector yet (or refresh all).
    Runs synchronously in the request for simplicity — use sparingly on large corpora.
    Requires OPENAI_API_KEY; returns 503 if not configured.
    """
    from app.core.config import settings
    from app.services.embedding_service import EmbeddingService

    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "OPENAI_API_KEY not configured — semantic search unavailable",
        )

    svc = EmbeddingService(db)
    if workspace_id:
        counts = await svc.reindex_workspace(workspace_id)
    else:
        counts = await svc.reindex_all()

    await db.commit()

    return ReindexResponse(
        **counts,
        message=(
            f"Indexed {counts['ok']} note(s). "
            f"{counts['skipped']} skipped (no content). "
            f"{counts['failed']} failed."
        ),
    )
