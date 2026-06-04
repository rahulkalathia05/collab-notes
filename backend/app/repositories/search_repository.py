"""
Full-text search repository.

Uses PostgreSQL's native FTS stack:
  - websearch_to_tsquery  — parses human-readable queries ("quick brown" → quick & brown)
  - @@ operator           — tsvector match
  - ts_rank_cd            — cover-density ranking (weights proximity of terms)
  - ts_headline           — generates highlighted <mark> snippets from plain text
  - search_vector         — stored generated column on notes (weighted A/C for title/body)
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


_SEARCH_SQL = text("""
    SELECT
        n.id            AS note_id,
        n.workspace_id,
        n.title,
        n.updated_at,
        w.name          AS workspace_name,
        ts_rank_cd(n.search_vector, q.query, 32)                     AS rank,
        ts_headline(
            'english', n.title, q.query,
            'MaxWords=10, MinWords=3, StartSel=<mark>, StopSel=</mark>, HighlightAll=false'
        )                                                             AS title_headline,
        ts_headline(
            'english', coalesce(n.content_text, ''), q.query,
            'MaxWords=60, MinWords=20, MaxFragments=3, StartSel=<mark>, StopSel=</mark>'
        )                                                             AS content_headline
    FROM notes n
    JOIN workspaces w  ON w.id = n.workspace_id
    JOIN workspace_members wm
         ON wm.workspace_id = n.workspace_id AND wm.user_id = :user_id,
    -- Lateral subquery so we compute the query expression once per row-set
    (SELECT websearch_to_tsquery('english', :q) AS query) AS q
    WHERE n.is_archived = false
      AND n.search_vector @@ q.query
      AND (:workspace_id::uuid IS NULL OR n.workspace_id = :workspace_id::uuid)
    ORDER BY rank DESC, n.updated_at DESC
    LIMIT :limit OFFSET :skip
""")

_COUNT_SQL = text("""
    SELECT COUNT(DISTINCT n.id)
    FROM notes n
    JOIN workspace_members wm
         ON wm.workspace_id = n.workspace_id AND wm.user_id = :user_id
    WHERE n.is_archived = false
      AND n.search_vector @@ websearch_to_tsquery('english', :q)
      AND (:workspace_id::uuid IS NULL OR n.workspace_id = :workspace_id::uuid)
""")


class SearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def search(
        self,
        user_id: UUID,
        query: str,
        skip: int,
        limit: int,
        workspace_id: UUID | None = None,
    ) -> list[dict]:
        params = {
            "user_id": str(user_id),
            "q": query,
            "skip": skip,
            "limit": limit,
            "workspace_id": str(workspace_id) if workspace_id else None,
        }
        result = await self.session.execute(_SEARCH_SQL, params)
        return [dict(row) for row in result.mappings()]

    async def count(
        self,
        user_id: UUID,
        query: str,
        workspace_id: UUID | None = None,
    ) -> int:
        params = {
            "user_id": str(user_id),
            "q": query,
            "workspace_id": str(workspace_id) if workspace_id else None,
        }
        result = await self.session.execute(_COUNT_SQL, params)
        return result.scalar_one() or 0
