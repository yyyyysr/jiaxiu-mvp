from http import HTTPStatus

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class DatabaseUnavailableError(Exception):
    """Raised when the research database cannot satisfy a request."""


def error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unavailable")
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "request_id": request_id},
        headers=headers,
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    default_code = "not_found" if exc.status_code == 404 else "http_error"
    default_message = (
        "未找到请求的资源。"
        if exc.status_code == 404
        else HTTPStatus(exc.status_code).phrase
    )
    return error_response(
        request,
        status_code=exc.status_code,
        code=str(detail.get("code", default_code)),
        message=str(detail.get("message", default_message)),
        headers=exc.headers,
    )


async def validation_exception_handler(
    request: Request, _exc: RequestValidationError
) -> JSONResponse:
    return error_response(
        request,
        status_code=422,
        code="validation_error",
        message="请求参数或内容无效。",
    )


async def database_unavailable_handler(
    request: Request, _exc: Exception
) -> JSONResponse:
    return error_response(
        request,
        status_code=503,
        code="database_unavailable",
        message="研究数据库暂不可用。",
    )
