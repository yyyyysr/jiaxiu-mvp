import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.dependencies.auth import require_admin, require_admin_csrf
from app.repositories.users import (
    LastAdminRequiredError,
    SelfDisableForbiddenError,
    UserNotFoundError,
    create_user,
    list_users,
    reset_user_password,
    set_user_active,
)
from app.schemas.auth import (
    AuthUser,
    CreateUserRequest,
    TemporaryPasswordResponse,
    UpdateUserRequest,
)
from app.services.auth import Principal

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def _temporary_password() -> str:
    return secrets.token_urlsafe(18)


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "user_not_found", "message": "未找到用户。"},
    )


@router.get("", response_model=list[AuthUser])
def users_list(
    request: Request,
    _principal: Annotated[Principal, Depends(require_admin)],
) -> list[AuthUser]:
    return [AuthUser.model_validate(user) for user in list_users(request.app.state.settings)]


@router.post("", response_model=TemporaryPasswordResponse, status_code=201)
def users_create(
    payload: CreateUserRequest,
    request: Request,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> TemporaryPasswordResponse:
    temporary_password = _temporary_password()
    try:
        user = create_user(
            request.app.state.settings,
            username=payload.username,
            password=temporary_password,
            role=payload.role,
            actor_user_id=principal.user_id,
            request_id=request.state.request_id,
            audit_action="user_created",
        )
    except ValueError as exc:
        code = "username_exists" if str(exc) == "用户名已存在。" else "invalid_user"
        status_code = 409 if code == "username_exists" else 422
        raise HTTPException(
            status_code=status_code,
            detail={"code": code, "message": str(exc)},
        ) from None
    return TemporaryPasswordResponse(
        user=AuthUser.model_validate(user), temporary_password=temporary_password
    )


@router.patch("/{user_id}", response_model=AuthUser)
def users_update(
    user_id: str,
    payload: UpdateUserRequest,
    request: Request,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> AuthUser:
    try:
        user = set_user_active(
            request.app.state.settings,
            user_id=user_id,
            is_active=payload.is_active,
            actor_user_id=principal.user_id,
            request_id=request.state.request_id,
        )
    except UserNotFoundError:
        raise _not_found() from None
    except LastAdminRequiredError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "last_admin_required",
                "message": "必须保留至少一个启用的管理员账户。",
            },
        ) from None
    except SelfDisableForbiddenError:
        raise HTTPException(
            status_code=409,
            detail={"code": "self_disable_forbidden", "message": "不能停用当前账户。"},
        ) from None
    return AuthUser.model_validate(user)


@router.post("/{user_id}/reset-password", response_model=TemporaryPasswordResponse)
def users_reset_password(
    user_id: str,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(require_admin_csrf)],
) -> TemporaryPasswordResponse:
    temporary_password = _temporary_password()
    try:
        user = reset_user_password(
            request.app.state.settings,
            user_id=user_id,
            temporary_password=temporary_password,
            actor_user_id=principal.user_id,
            request_id=request.state.request_id,
        )
    except UserNotFoundError:
        raise _not_found() from None
    if user_id == principal.user_id:
        settings = request.app.state.settings
        response.delete_cookie(
            "jiaxiu_session",
            path="/api/v1",
            secure=settings.session_cookie_secure,
            httponly=True,
            samesite="lax",
        )
    return TemporaryPasswordResponse(
        user=AuthUser.model_validate(user), temporary_password=temporary_password
    )
