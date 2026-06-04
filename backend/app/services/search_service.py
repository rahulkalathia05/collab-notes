"""
Search service — routes between keyword (FTS), semantic (vector), and hybrid search.

Hybrid mode uses Reciprocal Rank Fusion (RRF):
    score(d) = Σ 1 / (k + rank(d, list_i))
where k=60 is the standard RRF constant that dampens the impact of very high
ranks.  RRF is score-scale agnostic — it merges ranked lists without needing
to normalise FTS ranks and cosine similarities to the same range.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import CacheClient
from app.cache.keys import search_key
from app.core.config import settings
from app.models.user import User
from app.repositories.search_repository import SearchRepository
from app.repositories.semantic_search_repository import SemanticSearchRepository
from app.schemas.search import SearchMode, SearchResponse, SearchResultItem
from app.services.embedding_service import embed_query

_MIN_Q = 2
_MAX_Q = 200
_RRF_K = 60          # standard RRF constant
_POOL_SIZE = 40      # candidates from each source before RRF merge


class SearchService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.fts = SearchRepository(db)
        self.vec = SemanticSearchRepository(db)
        self.cache = CacheClient()

    async def search(
        self,
        user: User,
        query: str,
        page: int,
        page_size: int,
        workspace_id: UUID | None,
        mode: SearchMode,
    ) -> SearchResponse:
        q = query.strip()[:_MAX_Q]
        if len(q) < _MIN_Q:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Query must be at least {_MIN_Q} characters",
            )

        semantic_available = bool(settings.OPENAI_API_KEY)

        # Fall back to keyword if semantic is unavailable
        if mode in ("semantic", "hybrid") and not semantic_available:
            mode = "keyword"

        # Cache keyword searches — semantic / hybrid involve OpenAI API calls
        # which are already fast and user-specific enough to not warrant caching.
        if mode == "keyword":
            ckey = search_key(user.id, q, mode, workspace_id, page, page_size)
            cached = await self.cache.get_search(ckey)
            if cached is not None:
                return SearchResponse.model_validate(cached)

        skip = (page - 1) * page_size

        if mode == "keyword":
            rows, total = await asyncio.gather(
                self.fts.search(user.id, q, skip, page_size, workspace_id),
                self.fts.count(user.id, q, workspace_id),
            )
            items = [_fts_row_to_item(r) for r in rows]

        elif mode == "semantic":
            query_vec = await embed_query(q)
            if query_vec is None:
                raise HTTPException(
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    "Semantic search is temporarily unavailable",
                )
            rows = await self.vec.search(user.id, query_vec, page_size + skip, workspace_id)
            paged = rows[skip: skip + page_size]
            total = len(rows)  # approximate; full count would need a second query
            items = [_vec_row_to_item(r) for r in paged]

        else:  # hybrid
            query_vec = await embed_query(q)
            if query_vec is None:
                # Degrade gracefully to keyword-only
                rows, total = await asyncio.gather(
                    self.fts.search(user.id, q, skip, page_size, workspace_id),
                    self.fts.count(user.id, q, workspace_id),
                )
                items = [_fts_row_to_item(r) for r in rows]
            else:
                fts_rows, vec_rows = await asyncio.gather(
                    self.fts.search(user.id, q, 0, _POOL_SIZE, workspace_id),
                    self.vec.search(user.id, query_vec, _POOL_SIZE, workspace_id),
                )
                merged = _rrf_merge(fts_rows, vec_rows)
                total = len(merged)
                paged = merged[skip: skip + page_size]
                items = [_hybrid_row_to_item(r) for r in paged]

        response = SearchResponse(
            query=q,
            mode=mode,
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=max(1, (total + page_size - 1) // page_size),
            semantic_available=semantic_available,
        )

        if mode == "keyword":
            await self.cache.set_search(ckey, response.model_dump(mode="json"))

        return response


# ── RRF merge ─────────────────────────────────────────────────────────────────

def _rrf_merge(fts_rows: list[dict], vec_rows: list[dict]) -> list[dict]:
    """
    Merge two ranked lists with Reciprocal Rank Fusion.
    Returns a new list of dicts with added `rrf_score` and `similarity`.
    """
    scores: dict[str, float] = {}
    meta: dict[str, dict] = {}

    for rank, row in enumerate(fts_rows, start=1):
        nid = str(row["note_id"])
        scores[nid] = scores.get(nid, 0.0) + 1.0 / (_RRF_K + rank)
        meta[nid] = {**row, "similarity": None, "match_type": "hybrid"}

    for rank, row in enumerate(vec_rows, start=1):
        nid = str(row["note_id"])
        scores[nid] = scores.get(nid, 0.0) + 1.0 / (_RRF_K + rank)
        if nid in meta:
            meta[nid]["similarity"] = row["similarity"]
        else:
            meta[nid] = {**row, "similarity": row["similarity"], "match_type": "hybrid"}

    return [
        {**meta[nid], "rrf_score": score}
        for nid, score in sorted(scores.items(), key=lambda x: x[1], reverse=True)
    ]


# ── row → schema helpers ──────────────────────────────────────────────────────

def _fts_row_to_item(row: dict) -> SearchResultItem:
    return SearchResultItem(
        note_id=row["note_id"],
        workspace_id=row["workspace_id"],
        workspace_name=row["workspace_name"],
        title=row["title"],
        title_headline=row["title_headline"] or row["title"],
        content_headline=row["content_headline"] or "",
        rank=float(row["rank"]),
        similarity=None,
        match_type="keyword",
        updated_at=row["updated_at"],
    )


def _vec_row_to_item(row: dict) -> SearchResultItem:
    snippet = _excerpt(row.get("content_text") or "", 200)
    return SearchResultItem(
        note_id=row["note_id"],
        workspace_id=row["workspace_id"],
        workspace_name=row["workspace_name"],
        title=row["title"],
        title_headline=row["title"],   # no highlight for semantic-only
        content_headline=snippet,
        rank=float(row["similarity"]),
        similarity=float(row["similarity"]),
        match_type="semantic",
        updated_at=row["updated_at"],
    )


def _hybrid_row_to_item(row: dict) -> SearchResultItem:
    snippet = _excerpt(row.get("content_text") or "", 200)
    # Prefer FTS headline if present
    title_hl = row.get("title_headline") or row["title"]
    content_hl = row.get("content_headline") or snippet
    return SearchResultItem(
        note_id=row["note_id"],
        workspace_id=row["workspace_id"],
        workspace_name=row["workspace_name"],
        title=row["title"],
        title_headline=title_hl,
        content_headline=content_hl,
        rank=float(row.get("rrf_score", 0.0)),
        similarity=float(row["similarity"]) if row.get("similarity") is not None else None,
        match_type="hybrid",
        updated_at=row["updated_at"],
    )


def _excerpt(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0] + "…"
