from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class SearchResultItem(BaseModel):
    note_id: UUID
    workspace_id: UUID
    workspace_name: str
    title: str
    title_headline: str   # title with <mark> around matched terms
    content_headline: str # content snippet with <mark> around matched terms
    rank: float
    updated_at: datetime


class SearchResponse(BaseModel):
    query: str
    items: list[SearchResultItem]
    total: int
    page: int
    page_size: int
    pages: int
