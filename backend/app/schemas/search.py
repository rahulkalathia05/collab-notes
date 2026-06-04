from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel

SearchMode = Literal["keyword", "semantic", "hybrid"]


class SearchResultItem(BaseModel):
    note_id: UUID
    workspace_id: UUID
    workspace_name: str
    title: str
    title_headline: str    # FTS: title with <mark> tags; semantic: plain title
    content_headline: str  # FTS: snippet with <mark> tags; semantic: plain excerpt
    rank: float            # FTS rank, cosine similarity, or RRF score
    similarity: float | None = None  # cosine similarity (semantic / hybrid only)
    match_type: SearchMode = "keyword"
    updated_at: datetime


class SearchResponse(BaseModel):
    query: str
    mode: SearchMode
    items: list[SearchResultItem]
    total: int
    page: int
    page_size: int
    pages: int
    semantic_available: bool = True  # False when OPENAI_API_KEY not set


class ReindexResponse(BaseModel):
    ok: int
    skipped: int
    failed: int
    message: str
