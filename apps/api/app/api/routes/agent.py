import asyncio
from collections.abc import Awaitable
from contextlib import suppress
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.schemas.agent import ChatRequest, ChatResponse
from app.services.agent import AgentService
from app.services.rate_limit import PeerRateLimiter

router = APIRouter(prefix="/agent", tags=["agent"])


def get_agent_service(request: Request) -> AgentService:
    return request.app.state.agent_service


def get_rate_limiter(request: Request) -> PeerRateLimiter:
    return request.app.state.agent_rate_limiter


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
    service: Annotated[AgentService, Depends(get_agent_service)],
    limiter: Annotated[PeerRateLimiter, Depends(get_rate_limiter)],
) -> ChatResponse:
    peer = request.client.host if request.client is not None else "unknown"
    if not await limiter.allow(peer):
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "请求过于频繁，请稍后再试。"},
        )
    return await complete_unless_disconnected(request, service.chat(payload))
