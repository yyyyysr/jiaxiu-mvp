import sqlite3
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.api.routes.admin_audit import router as admin_audit_router
from app.api.routes.admin_submissions import router as admin_submissions_router
from app.api.routes.admin_users import router as admin_users_router
from app.api.routes.agent import router as agent_router
from app.api.routes.auth import router as auth_router
from app.api.routes.contributions import router as contributions_router
from app.api.routes.health import router as health_router
from app.api.routes.health import validate_database
from app.api.routes.scene import router as scene_router
from app.api.routes.search import router as search_router
from app.api.routes.submissions import router as submissions_router
from app.api.routes.works import router as works_router
from app.app_db import migrate_app_db
from app.core.config import Settings
from app.core.errors import (
    DatabaseUnavailableError,
    database_unavailable_handler,
    error_response,
    http_exception_handler,
    validation_exception_handler,
)
from app.repositories.submissions import (
    reconcile_submission_file_cleanup,
    sweep_submission_file_cleanup,
)
from app.services.agent import AgentService, build_chat_provider
from app.services.rate_limit import LoginFailureRateLimiter, PeerRateLimiter


@asynccontextmanager
async def _lifespan(app: FastAPI):
    migrate_app_db(app.state.settings)
    reconcile_submission_file_cleanup(app.state.settings)
    sweep_submission_file_cleanup(app.state.settings)
    try:
        validate_database(app.state.settings)
    except DatabaseUnavailableError:
        app.state.database_ready = False
    else:
        app.state.database_ready = True
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="Jiaxiu Tower Research API", lifespan=_lifespan)
    app.state.settings = settings or Settings()
    app.state.agent_service = AgentService(
        settings=app.state.settings,
        provider=build_chat_provider(app.state.settings),
    )
    app.state.agent_rate_limiter = PeerRateLimiter(
        max_requests=app.state.settings.agent_rate_limit_requests,
        window_seconds=app.state.settings.agent_rate_limit_window_seconds,
        max_clients=app.state.settings.agent_rate_limit_max_clients,
    )
    app.state.login_rate_limiter = LoginFailureRateLimiter(
        max_failures=app.state.settings.login_rate_limit_failures,
        window_seconds=app.state.settings.login_rate_limit_window_seconds,
        max_clients=app.state.settings.login_rate_limit_max_clients,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app.state.settings.cors_allowed_origins),
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Content-Type",
            "Range",
            "If-Range",
            "X-CSRF-Token",
        ],
        allow_credentials=True,
        expose_headers=[
            "Accept-Ranges",
            "Content-Length",
            "Content-Range",
            "Content-Disposition",
            "ETag",
            "Last-Modified",
            "X-Content-Type-Options",
            "X-Request-ID",
        ],
    )
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(DatabaseUnavailableError, database_unavailable_handler)
    app.add_exception_handler(sqlite3.Error, database_unavailable_handler)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = uuid4().hex
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 - sanitize the outermost HTTP boundary
            response = error_response(
                request,
                status_code=500,
                code="internal_error",
                message="服务暂时无法处理该请求。",
            )
        response.headers["X-Request-ID"] = request_id
        return response

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(works_router, prefix="/api/v1")
    app.include_router(contributions_router, prefix="/api/v1")
    app.include_router(search_router, prefix="/api/v1")
    app.include_router(scene_router, prefix="/api/v1")
    app.include_router(agent_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(admin_users_router, prefix="/api/v1")
    app.include_router(admin_submissions_router, prefix="/api/v1")
    app.include_router(admin_audit_router, prefix="/api/v1")
    app.include_router(submissions_router, prefix="/api/v1")
    return app


app = create_app()
