import asyncio
import json
import secrets
import sqlite3
from collections.abc import Awaitable
from contextlib import suppress
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError

from app.core.config import Settings
from app.repositories.guide_conversations import (
    append_exchange,
    clear_conversation,
    guest_digest,
    load_messages,
)
from app.schemas.agent import ChatRequest, ChatResponse, GuideConversation, GuideTurn
from app.services.agent import AgentService
from app.services.auth import Principal, csrf_token_matches, resolve_session_readonly
from app.services.rate_limit import PeerRateLimiter

router = APIRouter(prefix="/agent", tags=["agent"])

GUIDE_COOKIE = "jiaxiu_guide"
_GUEST_TOKEN_BYTES = 32
_GUEST_TOKEN_LENGTH = 43


def get_agent_service(request: Request) -> AgentService:
    return request.app.state.agent_service


def get_rate_limiter(request: Request) -> PeerRateLimiter:
    return request.app.state.agent_rate_limiter


@dataclass(frozen=True)
class ThreadOwner:
    """Whose transcript this is: an account, or a browser holding a guest cookie."""

    user_id: str | None
    digest: str | None
    scope: str


def _principal(request: Request) -> Principal | None:
    raw_token = request.cookies.get("jiaxiu_session")
    if not raw_token:
        return None
    settings: Settings = request.app.state.settings
    return resolve_session_readonly(settings, raw_token)


def _existing_guest_token(request: Request) -> str | None:
    token = request.cookies.get(GUIDE_COOKIE)
    if token is None or len(token) != _GUEST_TOKEN_LENGTH:
        return None
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    return token if set(token) <= allowed else None


def _resolve_owner(request: Request, response: Response, *, issue_cookie: bool) -> ThreadOwner:
    principal = _principal(request)
    if principal is not None:
        return ThreadOwner(user_id=principal.user_id, digest=None, scope="account")
    token = _existing_guest_token(request)
    if token is None:
        if not issue_cookie:
            return ThreadOwner(user_id=None, digest=None, scope="guest")
        token = secrets.token_urlsafe(_GUEST_TOKEN_BYTES)
        settings: Settings = request.app.state.settings
        # A session cookie, deliberately: the anonymous thread lasts as long as the browser
        # keeps it, and clearing cookies is the documented way to start over.
        response.set_cookie(
            GUIDE_COOKIE,
            token,
            httponly=True,
            secure=settings.session_cookie_secure,
            samesite="lax",
            path="/api/v1",
        )
    return ThreadOwner(user_id=None, digest=guest_digest(token), scope="guest")


def _stored_turns(request: Request, owner: ThreadOwner) -> list[GuideTurn]:
    if owner.user_id is None and owner.digest is None:
        return []
    settings: Settings = request.app.state.settings
    try:
        records = load_messages(settings, user_id=owner.user_id, digest=owner.digest)
    except sqlite3.Error:
        return []
    turns: list[GuideTurn] = []
    for record in records:
        answer: ChatResponse | None = None
        if record.role == "assistant" and record.response_json:
            with suppress(ValidationError, ValueError):
                answer = ChatResponse.model_validate(json.loads(record.response_json))
        with suppress(ValidationError):
            turns.append(
                GuideTurn(
                    role=record.role,
                    content=record.content,
                    created_at=record.created_at,
                    response=answer,
                )
            )
    return turns


async def _wait_for_disconnect(request: Request, poll_interval: float) -> None:
    receive = getattr(request, "receive", None)
    if receive is not None:
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
    while not await request.is_disconnected():
        await asyncio.sleep(poll_interval)


async def complete_unless_disconnected(
    request: Request,
    call: Awaitable[ChatResponse],
    *,
    poll_interval: float = 0.05,
) -> ChatResponse:
    service_task = asyncio.create_task(call)
    disconnect_task = asyncio.create_task(_wait_for_disconnect(request, poll_interval))
    try:
        done, _pending = await asyncio.wait(
            {service_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if service_task in done:
            return await service_task
        service_task.cancel()
        with suppress(asyncio.CancelledError):
            await service_task
        raise asyncio.CancelledError
    finally:
        if not service_task.done():
            service_task.cancel()
        if not disconnect_task.done():
            disconnect_task.cancel()
        with suppress(asyncio.CancelledError):
            await service_task
        with suppress(asyncio.CancelledError):
            await disconnect_task


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    response: Response,
    service: Annotated[AgentService, Depends(get_agent_service)],
    limiter: Annotated[PeerRateLimiter, Depends(get_rate_limiter)],
) -> ChatResponse:
    peer = request.client.host if request.client is not None else "unknown"
    if not await limiter.allow(peer):
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "请求过于频繁，请稍后再试。"},
        )
    owner = _resolve_owner(request, response, issue_cookie=True)
    answer = await complete_unless_disconnected(request, service.chat(payload))
    settings: Settings = request.app.state.settings
    # Filing the transcript must never cost the reader their answer.
    with suppress(sqlite3.Error, ValueError):
        append_exchange(
            settings,
            user_id=owner.user_id,
            digest=owner.digest,
            question=payload.message,
            answer=answer.answer,
            response_json=json.dumps(answer.model_dump(mode="json"), ensure_ascii=False),
        )
    return answer


@router.get("/conversation", response_model=GuideConversation)
def read_conversation(request: Request, response: Response) -> GuideConversation:
    """Replay the reader's running thread so a reload does not erase what was said."""
    owner = _resolve_owner(request, response, issue_cookie=False)
    return GuideConversation(scope=owner.scope, messages=_stored_turns(request, owner))


@router.delete("/conversation", status_code=204)
def delete_conversation(request: Request, response: Response) -> None:
    owner = _resolve_owner(request, response, issue_cookie=False)
    if owner.user_id is not None:
        principal = _principal(request)
        raw_csrf_token = request.headers.get("X-CSRF-Token", "")
        if principal is None or not raw_csrf_token or not csrf_token_matches(principal, raw_csrf_token):
            raise HTTPException(
                status_code=403,
                detail={"code": "csrf_validation_failed", "message": "CSRF 校验失败。"},
            )
    elif owner.digest is None:
        return
    settings: Settings = request.app.state.settings
    with suppress(sqlite3.Error, ValueError):
        clear_conversation(settings, user_id=owner.user_id, digest=owner.digest)
