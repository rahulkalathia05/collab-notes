from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import BLOCKLIST_KEY, decode_token
from app.db.redis import get_redis
from app.db.session import get_session
from app.models.user import User
from app.repositories.user_repository import UserRepository

_bearer = HTTPBearer()


# ── infrastructure ────────────────────────────────────────────────────────────

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_session():
        yield session


async def get_redis_dep() -> AsyncGenerator[aioredis.Redis, None]:
    async for client in get_redis():
        yield client


# ── token extraction ──────────────────────────────────────────────────────────

async def get_token_payload(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    Decodes and returns the raw JWT payload without a DB or Redis lookup.
    Use for endpoints that only need token metadata (e.g. logout).
    """
    try:
        return decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── authenticated user ────────────────────────────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_dep),
) -> User:
    """
    Full auth guard: decode JWT → check blocklist → load user from DB.
    Raises 401 at the first failing step with a deliberately generic message.
    """
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(credentials.credentials)
    except JWTError:
        raise exc

    if payload.get("type") != "access":
        raise exc

    jti = payload.get("jti", "")
    if jti and await redis.exists(BLOCKLIST_KEY.format(jti=jti)):
        raise exc

    # payload["sub"] is always present on valid tokens we issue, but guard
    # against malformed tokens that somehow pass signature verification.
    user_id = payload.get("sub")
    if not user_id:
        raise exc

    user = await UserRepository(db).get(user_id)
    if not user:
        raise exc

    return user


# ── service factory ───────────────────────────────────────────────────────────

def get_auth_service(
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_dep),
):
    """
    Injects a ready-to-use AuthService. Routes take a single dependency
    instead of wiring db + redis separately in every handler.
    """
    from app.services.auth_service import AuthService  # local import avoids circular dep

    return AuthService(db, redis)
