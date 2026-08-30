from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.dependencies.auth import (
    require_csrf_for_password_change,
    require_user_for_password_change_readonly,
)
from app.core.config import Settings
from app.repositories.users import get_user_credentials, normalize_username
from app.schemas.auth import AuthSession, AuthUser, ChangePasswordRequest, LoginRequest
from app.services.auth import (
    CurrentPasswordInvalidError,
    Principal,
    change_password_and_rotate_session,
    create_session_with_audit,
    record_login_failed,
    record_login_rate_limited,
    recover_csrf_token,
    revoke_session_with_audit,
    verify_login_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, settings: Settings, raw_token: str) -> None:
    response.set_cookie(
        "jiaxiu_session",
        raw_token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_seconds,
        path="/api/v1",
    )


def _auth_user(principal: Principal, *, must_change_password: bool | None = None) -> AuthUser:
    return AuthUser(
        user_id=principal.user_id,
        username=principal.username,
        role=principal.role,
        is_active=True,
        must_change_password=(
            principal.must_change_password if must_change_password is None else must_change_password
        ),
    )


@router.post("/login", response_model=AuthSession)
async def login(payload: LoginRequest, request: Request, response: Response) -> AuthSession:
    settings: Settings = request.app.state.settings
    normalized_username = normalize_username(payload.username)
    peer = request.client.host if request.client is not None else "unknown"
    rate_key = (peer, normalized_username)
    allowed = await request.app.state.login_rate_limiter.begin_attempt(rate_key)
    if not allowed:
        record_login_rate_limited(settings, request_id=request.state.request_id)
        raise HTTPException(
            status_code=429,
            detail={
                "code": "login_rate_limited",
                "message": "登录尝试过于频繁，请稍后重试。",
            },
        )
    credentials = get_user_credentials(settings, normalized_username)
    password_hash = credentials.password_hash if credentials is not None else None
    valid_password = verify_login_password(password_hash, payload.password)
    valid_account = credentials is not None and credentials.user.is_active
    if not valid_password or not valid_account:
        record_login_failed(
            settings,
            target_user_id=(credentials.user.user_id if credentials is not None else None),
            request_id=request.state.request_id,
        )
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_credentials", "message": "用户名或密码错误。"},
        )
    await request.app.state.login_rate_limiter.clear(rate_key)
    raw_token, raw_csrf = create_session_with_audit(
        settings,
        user_id=credentials.user.user_id,
        request_id=request.state.request_id,
    )
    _set_session_cookie(response, settings, raw_token)
    return AuthSession(
        user=AuthUser.model_validate(credentials.user),
        csrf_token=raw_csrf,
    )


@router.get("/me", response_model=AuthSession)
def me(
    request: Request,
    principal: Annotated[Principal, Depends(require_user_for_password_change_readonly)],
) -> AuthSession:
    raw_cookie_token = request.cookies.get("jiaxiu_session", "")
    csrf_token = recover_csrf_token(raw_cookie_token)
    if csrf_token is None:  # The dependency has already validated this envelope.
        raise HTTPException(status_code=401, detail={"code": "authentication_required"})
    return AuthSession(user=_auth_user(principal), csrf_token=csrf_token)


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(require_csrf_for_password_change)],
) -> None:
    settings: Settings = request.app.state.settings
    revoke_session_with_audit(settings, principal=principal, request_id=request.state.request_id)
    response.delete_cookie(
        "jiaxiu_session",
        path="/api/v1",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


@router.post("/change-password", response_model=AuthSession)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(require_csrf_for_password_change)],
) -> AuthSession:
    settings: Settings = request.app.state.settings
    try:
        raw_token, raw_csrf = change_password_and_rotate_session(
            settings,
            principal=principal,
            current_password=payload.current_password,
            new_password=payload.new_password,
            request_id=request.state.request_id,
        )
    except CurrentPasswordInvalidError:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_current_password",
                "message": "当前密码不正确。",
            },
        ) from None
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_password", "message": str(exc)},
        ) from None
    _set_session_cookie(response, settings, raw_token)
    return AuthSession(
        user=_auth_user(principal, must_change_password=False),
        csrf_token=raw_csrf,
    )
