from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.core.config import Settings
from app.services.auth import (
    Principal,
    csrf_token_matches,
    resolve_session,
    resolve_session_readonly,
)


def _authentication_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "authentication_required", "message": "请先登录。"},
    )


def _password_change_error() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "password_change_required",
            "message": "请先修改临时密码。",
        },
    )


def _resolve_request_user(request: Request, *, allow_password_change_required: bool) -> Principal:
    raw_token = request.cookies.get("jiaxiu_session")
    if not raw_token:
        raise _authentication_error()
    settings: Settings = request.app.state.settings
    principal = resolve_session(settings, raw_token)
    if principal is None:
        raise _authentication_error()
    if principal.must_change_password and not allow_password_change_required:
        raise _password_change_error()
    return principal


def require_user(request: Request) -> Principal:
    """Authenticate a protected business route, denying temporary passwords."""
    return _resolve_request_user(request, allow_password_change_required=False)


def require_user_for_password_change(request: Request) -> Principal:
    """Authenticate one of the explicitly allowed forced-password-change routes."""
    return _resolve_request_user(request, allow_password_change_required=True)


def require_user_for_password_change_readonly(request: Request) -> Principal:
    raw_token = request.cookies.get("jiaxiu_session")
    if not raw_token:
        raise _authentication_error()
    settings: Settings = request.app.state.settings
    principal = resolve_session_readonly(settings, raw_token)
    if principal is None:
        raise _authentication_error()
    return principal


def require_admin(
    principal: Annotated[Principal, Depends(require_user)],
) -> Principal:
    if principal.role != "admin":
        raise HTTPException(
            status_code=403,
            detail={"code": "admin_required", "message": "需要管理员权限。"},
        )
    return principal


def require_contributor(
    principal: Annotated[Principal, Depends(require_user)],
) -> Principal:
    if principal.role != "contributor":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "contributor_required",
                "message": "需要投稿人账户。",
            },
        )
    return principal


def require_admin_csrf(
    request: Request,
    principal: Annotated[Principal, Depends(require_admin)],
) -> Principal:
    return _require_csrf_header(request, principal)


def require_contributor_csrf(
    request: Request,
    principal: Annotated[Principal, Depends(require_contributor)],
) -> Principal:
    return _require_csrf_header(request, principal)


def _require_csrf_header(request: Request, principal: Principal) -> Principal:
    if request.method not in {"POST", "PATCH", "DELETE"}:
        return principal
    raw_csrf_token = request.headers.get("X-CSRF-Token", "")
    if not raw_csrf_token or not csrf_token_matches(principal, raw_csrf_token):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "csrf_validation_failed",
                "message": "CSRF 校验失败。",
            },
        )
    return principal


def require_csrf(
    request: Request,
    principal: Annotated[Principal, Depends(require_user)],
) -> Principal:
    return _require_csrf_header(request, principal)


def require_csrf_for_password_change(
    request: Request,
    principal: Annotated[Principal, Depends(require_user_for_password_change)],
) -> Principal:
    """Apply CSRF checks to logout/change-password during the forced flow."""
    return _require_csrf_header(request, principal)
