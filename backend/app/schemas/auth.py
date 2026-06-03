from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, field_validator

from app.core.security import check_password_strength


def _validate_password(v: str) -> str:
    errors = check_password_strength(v)
    if errors:
        raise ValueError(f"Password must have: {', '.join(errors)}")
    return v


# ── requests ──────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be blank")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    """Sending the refresh_token enables server-side revocation of the refresh token."""
    refresh_token: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def new_password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    avatar_url: str | None = None


# ── responses ─────────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    name: str
    avatar_url: str | None
    created_at: datetime
