"""
Semantic search repository — nearest-neighbour queries via pgvector.

Uses cosine distance (<=>):
  similarity = 1 - cosine_distance  (1.0 = identical, 0.0 = orthogonal)

ef_search is set per-session before the query.  Higher values give better
recall at the cost of slightly more CPU.  64 is a good balance for most
workloads; increase to 128+ for high-recall requirements.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_EF_SEARCH = 64  # HNSW query-time recall parameter


class SemanticSearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def search(
        self,
        user_id: UUID,
        query_vector: list[float],
        limit: int,
        workspace_id: UUID | None = None,
    ) -> list[dict]:
        """
        Return the `limit` nearest notes to `query_vector` that the user
        can access, ordered by cosine similarity descending.
        """
        # Tune HNSW recall for this session
        await self.session.execute(
            text(f"SET LOCAL hnsw.ef_search = {_EF_SEARCH}")
        )

        sql = text("""
            SELECT
                n.id            AS note_id,
                n.workspace_id,
                n.title,
                n.updated_at,
                n.content_text,
                w.name          AS workspace_name,
                1 - (ne.embedding <=> :vec::vector) AS similarity
            FROM note_embeddings ne
            JOIN notes n         ON n.id = ne.note_id
            JOIN workspaces w    ON w.id = n.workspace_id
            JOIN workspace_members wm
                 ON wm.workspace_id = n.workspace_id AND wm.user_id = :user_id
            WHERE n.is_archived = false
              AND (:workspace_id::uuid IS NULL OR n.workspace_id = :workspace_id::uuid)
            ORDER BY ne.embedding <=> :vec::vector
            LIMIT :limit
        """)

        result = await self.session.execute(sql, {
            "vec": str(query_vector),
            "user_id": str(user_id),
            "workspace_id": str(workspace_id) if workspace_id else None,
            "limit": limit,
        })
        return [dict(row) for row in result.mappings()]

    async def count_indexed(self, user_id: UUID, workspace_id: UUID | None = None) -> int:
        """How many notes the user can access that already have embeddings."""
        sql = text("""
            SELECT COUNT(DISTINCT ne.note_id)
            FROM note_embeddings ne
            JOIN workspace_members wm ON wm.workspace_id = (
                SELECT workspace_id FROM notes WHERE id = ne.note_id
            ) AND wm.user_id = :user_id
            WHERE (:workspace_id::uuid IS NULL
                   OR (SELECT workspace_id FROM notes WHERE id = ne.note_id) = :workspace_id::uuid)
        """)
        result = await self.session.execute(sql, {
            "user_id": str(user_id),
            "workspace_id": str(workspace_id) if workspace_id else None,
        })
        return result.scalar_one() or 0
