from fastapi import APIRouter, Depends, status

from app.core.dependencies import (
    get_auth_service,
    get_current_user,
    get_token_payload,
)
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


# ── public ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, svc: AuthService = Depends(get_auth_service)):
    return await svc.register(body)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, svc: AuthService = Depends(get_auth_service)):
    return await svc.login(body)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, svc: AuthService = Depends(get_auth_service)):
    return await svc.refresh(body)


# ── protected ─────────────────────────────────────────────────────────────────

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: LogoutRequest,
    payload: dict = Depends(get_token_payload),
    svc: AuthService = Depends(get_auth_service),
):
    await svc.logout(
        access_jti=payload.get("jti", ""),
        access_exp=int(payload.get("exp", 0)),
        refresh_token=body.refresh_token,
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    svc: AuthService = Depends(get_auth_service),
):
    return await svc.update_profile(current_user, body)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    svc: AuthService = Depends(get_auth_service),
):
    await svc.change_password(current_user, body)
