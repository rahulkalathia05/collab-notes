import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

from app.core.config import settings


# ── password hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def check_password_strength(password: str) -> list[str]:
    """Returns a list of unmet requirements. Empty list = strong enough."""
    errors: list[str] = []
    if len(password) < 8:
        errors.append("at least 8 characters")
    if not any(c.isupper() for c in password):
        errors.append("at least one uppercase letter")
    if not any(c.islower() for c in password):
        errors.append("at least one lowercase letter")
    if not any(c.isdigit() for c in password):
        errors.append("at least one digit")
    return errors


# Precomputed hash used in login() so bcrypt always runs regardless of whether
# the email exists — prevents user-enumeration via response-time differences.
DUMMY_HASH: str = hash_password("collabnotes-timing-guard")


# ── JWT ───────────────────────────────────────────────────────────────────────

def _jti() -> str:
    return secrets.token_hex(16)


def create_access_token(subject: str) -> tuple[str, str]:
    """Returns (token, jti). JTI is blocklisted on logout."""
    jti = _jti()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = jwt.encode(
        {"sub": subject, "jti": jti, "exp": expire, "type": "access"},
        settings.SECRET_KEY,
        settings.ALGORITHM,
    )
    return token, jti


def create_refresh_token(subject: str) -> tuple[str, str]:
    """Returns (token, jti). JTI is stored in Redis and validated on every use."""
    jti = _jti()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    token = jwt.encode(
        {"sub": subject, "jti": jti, "exp": expire, "type": "refresh"},
        settings.SECRET_KEY,
        settings.ALGORITHM,
    )
    return token, jti


def decode_token(token: str) -> dict:
    """
    Decodes and verifies a JWT. Returns the full payload dict.
    Raises jose.JWTError on invalid signature, expiry, or malformed input.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


# ── Redis key patterns ────────────────────────────────────────────────────────
# Single source of truth for all token-related Redis keys.
# Used by both AuthService and get_current_user — define here to prevent drift.

REFRESH_KEY = "refresh:{jti}"      # value: user_id  TTL: REFRESH_TOKEN_EXPIRE_DAYS
BLOCKLIST_KEY = "blocklist:{jti}"  # value: "1"       TTL: remaining access token lifetime
