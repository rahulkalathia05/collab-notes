from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


class NoteCreate(BaseModel):
    title: str = "Untitled"
    content: dict[str, Any] | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: str) -> str:
        return v.strip() or "Untitled"


class NoteUpdate(BaseModel):
    title: str | None = None
    content: dict[str, Any] | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Title cannot be blank")
        return v.strip() if v else v


class UserMini(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    name: str
    avatar_url: str | None = None


class NoteVersionCreate(BaseModel):
    label: str | None = Field(None, max_length=255)


class NoteVersionUpdate(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)


# ── responses ─────────────────────────────────────────────────────────────────

class NoteListItem(BaseModel):
    """Lightweight projection for list views — omits content JSONB."""
    model_config = {"from_attributes": True}

    id: UUID
    workspace_id: UUID
    title: str
    created_by: UUID
    updated_by: UUID | None
    is_pinned: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class NoteResponse(BaseModel):
    """Full note including content — used for GET /{note_id}."""
    model_config = {"from_attributes": True}

    id: UUID
    workspace_id: UUID
    title: str
    content: dict[str, Any] | None
    created_by: UUID
    updated_by: UUID | None
    is_pinned: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class NoteVersionResponse(BaseModel):
    """Includes content so the UI can preview/restore versions."""
    model_config = {"from_attributes": True}

    id: UUID
    note_id: UUID
    content: dict[str, Any]
    content_text: str | None
    label: str | None
    snapshot_by: UUID
    snapshotter: UserMini
    created_at: datetime
