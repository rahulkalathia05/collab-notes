from datetime import datetime, timezone

import redis.asyncio as aioredis
from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    BLOCKLIST_KEY,
    DUMMY_HASH,
    REFRESH_KEY,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UpdateProfileRequest,
)


class AuthService:
    def __init__(self, db: AsyncSession, redis: aioredis.Redis) -> None:
        self.repo = UserRepository(db)
        self.redis = redis

    # ── public methods ────────────────────────────────────────────────────────

    async def register(self, data: RegisterRequest) -> TokenResponse:
        if await self.repo.get_by_email(data.email):
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

        user = await self.repo.create(
            email=data.email.lower(),
            name=data.name,
            password_hash=hash_password(data.password),
        )
        return await self._issue_tokens(str(user.id))

    async def login(self, data: LoginRequest) -> TokenResponse:
        user = await self.repo.get_by_email(data.email)

        # Always run bcrypt even when the user is not found so that unknown
        # and known-but-wrong-password requests take the same time.
        # This prevents user-enumeration via response-time differences.
        password_ok = verify_password(
            data.password,
            user.password_hash if user else DUMMY_HASH,
        )
        if not user or not password_ok:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

        return await self._issue_tokens(str(user.id))

    async def logout(
        self,
        access_jti: str,
        access_exp: int,
        refresh_token: str | None,
    ) -> None:
        """
        Best-effort revocation — a missing JTI is not an error.
        Blocklists the access token for its remaining lifetime and
        removes the refresh token JTI from Redis.
        """
        remaining = int(access_exp) - int(datetime.now(timezone.utc).timestamp())
        if access_jti and remaining > 0:
            await self.redis.set(BLOCKLIST_KEY.format(jti=access_jti), "1", ex=remaining)

        if refresh_token:
            try:
                payload = decode_token(refresh_token)
                rt_jti = payload.get("jti")
                if rt_jti:
                    await self.redis.delete(REFRESH_KEY.format(jti=rt_jti))
            except JWTError:
                pass  # already invalid — nothing to remove

    async def refresh(self, data: RefreshRequest) -> TokenResponse:
        """
        Validates the refresh token against Redis (existence = not yet used),
        deletes it (rotation), then issues a fresh pair.
        Raises 401 if expired, invalid, already used, or user deleted.
        """
        try:
            payload = decode_token(data.refresh_token)
        except JWTError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")

        if payload.get("type") != "refresh":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not a refresh token")

        rt_jti = payload.get("jti", "")
        user_id = payload.get("sub", "")

        if not await self.redis.get(REFRESH_KEY.format(jti=rt_jti)):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Refresh token has been revoked or already used",
            )

        user = await self.repo.get(user_id)
        if not user:
            await self.redis.delete(REFRESH_KEY.format(jti=rt_jti))
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")

        await self.redis.delete(REFRESH_KEY.format(jti=rt_jti))
        return await self._issue_tokens(user_id)

    async def change_password(self, user: User, data: ChangePasswordRequest) -> None:
        if not verify_password(data.current_password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
        user.password_hash = hash_password(data.new_password)
        await self.repo.save(user)

    async def update_profile(self, user: User, data: UpdateProfileRequest) -> User:
        # Explicit field assignment — makes the allowed set obvious and avoids
        # accidental writes if the schema ever grows fields like `email`.
        if data.name is not None:
            user.name = data.name
        if data.avatar_url is not None:
            user.avatar_url = data.avatar_url
        return await self.repo.save(user)

    # ── private ───────────────────────────────────────────────────────────────

    async def _issue_tokens(self, user_id: str) -> TokenResponse:
        access_token, _ = create_access_token(user_id)
        refresh_token, refresh_jti = create_refresh_token(user_id)

        await self.redis.set(
            REFRESH_KEY.format(jti=refresh_jti),
            user_id,
            ex=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86_400,
        )
        return TokenResponse(access_token=access_token, refresh_token=refresh_token)
