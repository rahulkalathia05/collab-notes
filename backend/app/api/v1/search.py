from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.search import SearchResponse
from app.services.search_service import SearchService

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/", response_model=SearchResponse)
async def search_notes(
    q: str = Query(..., min_length=2, max_length=200, description="Search query"),
    workspace_id: UUID | None = Query(None, description="Scope to a specific workspace"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Full-text search across all notes the user has access to.

    Uses PostgreSQL FTS with:
    - websearch_to_tsquery for human-readable query parsing
    - ts_rank_cd for cover-density ranking (title weighted higher than body)
    - ts_headline for <mark>-highlighted snippet generation
    """
    return await SearchService(db).search(
        user=current_user,
        query=q,
        page=page,
        page_size=page_size,
        workspace_id=workspace_id,
    )
