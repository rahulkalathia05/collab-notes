from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


# ── embedded user info ────────────────────────────────────────────────────────

class UserMini(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    name: str
    email: str
    avatar_url: str | None = None


# ── workspace requests ────────────────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    name: str
    icon: str | None = "📁"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip() if v else v


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    owner_id: UUID
    icon: str | None
    created_at: datetime
    updated_at: datetime
    role: str
    member_count: int


class PaginatedWorkspaces(BaseModel):
    items: list[WorkspaceResponse]
    total: int
    page: int
    page_size: int
    pages: int


class WorkspaceMemberResponse(BaseModel):
    model_config = {"from_attributes": True}

    workspace_id: UUID
    user: UserMini
    role: str
    joined_at: datetime


class InviteMemberRequest(BaseModel):
    email: str
    role: str = "editor"

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ("editor", "viewer"):
            raise ValueError("Role must be editor or viewer")
        return v


class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(..., description="New role for the member")

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ("admin", "editor", "viewer"):
            raise ValueError("Role must be admin, editor, or viewer")
        return v
