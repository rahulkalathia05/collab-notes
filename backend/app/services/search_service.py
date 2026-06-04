from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.search_repository import SearchRepository
from app.schemas.search import SearchResponse, SearchResultItem

_MIN_QUERY_LEN = 2
_MAX_QUERY_LEN = 200


class SearchService:
    def __init__(self, db: AsyncSession) -> None:
        self.repo = SearchRepository(db)

    async def search(
        self,
        user: User,
        query: str,
        page: int,
        page_size: int,
        workspace_id: UUID | None,
    ) -> SearchResponse:
        q = query.strip()
        if len(q) < _MIN_QUERY_LEN:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Query must be at least {_MIN_QUERY_LEN} characters",
            )
        if len(q) > _MAX_QUERY_LEN:
            q = q[:_MAX_QUERY_LEN]

        skip = (page - 1) * page_size

        rows, total = await _run_parallel_queries(
            self.repo, user.id, q, skip, page_size, workspace_id
        )

        items = [SearchResultItem(**row) for row in rows]

        return SearchResponse(
            query=q,
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=max(1, (total + page_size - 1) // page_size),
        )


async def _run_parallel_queries(repo, user_id, q, skip, limit, workspace_id):
    """Fire search + count concurrently — both hit the GIN index."""
    import asyncio
    results, total = await asyncio.gather(
        repo.search(user_id, q, skip, limit, workspace_id),
        repo.count(user_id, q, workspace_id),
    )
    return results, total
