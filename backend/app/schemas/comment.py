from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ── embedded user info ────────────────────────────────────────────────────────

class UserMini(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    name: str
    avatar_url: str | None = None


# ── requests ──────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5_000)
    comment_type: Literal["note", "selection"] = "note"
    # Populated only when comment_type == "selection"
    selection_from: int | None = None
    selection_to: int | None = None
    anchor_text: str | None = Field(None, max_length=1_000)


class ReplyCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5_000)


# ── responses ─────────────────────────────────────────────────────────────────

class ReplyResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    note_id: UUID
    parent_id: UUID
    user: UserMini
    content: str
    created_at: datetime
    updated_at: datetime


class CommentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    note_id: UUID
    parent_id: UUID | None
    user: UserMini
    content: str
    comment_type: str
    selection_from: int | None
    selection_to: int | None
    anchor_text: str | None
    resolved: bool
    resolved_by: UUID | None
    created_at: datetime
    updated_at: datetime
    replies: list[ReplyResponse] = []
