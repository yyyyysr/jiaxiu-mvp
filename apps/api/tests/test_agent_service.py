import asyncio
import json

import httpx

from app.core.config import Settings
from app.schemas.agent import ChatRequest, ProviderAnswer
from app.services.agent import AgentService, OpenAIChatProvider, ProviderUnavailableError


class RecordingProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, **_kwargs: object) -> ProviderAnswer:
        self.calls += 1
        return ProviderAnswer(answer="你好，我是浮玉客。", evidence_ids=[], scene_action=None)


class FailingProvider:
    async def complete(self, **_kwargs: object) -> ProviderAnswer:
        raise ProviderUnavailableError("provider unavailable")


class StructuredOutputRejectingProvider(OpenAIChatProvider):
    def __init__(self) -> None:
        super().__init__(
            base_url="https://example.com/v1",
            api_key="test-key",
            model="test-model",
        )
        self.payloads: list[dict[str, object]] = []

    async def _post(self, payload: dict[str, object]) -> bytes:
        self.payloads.append(payload)
        if len(self.payloads) == 1:
            request = httpx.Request("POST", "https://example.com/v1/chat/completions")
            response = httpx.Response(400, request=request)
            raise httpx.HTTPStatusError("unsupported response format", request=request, response=response)
        return json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"answer": "你好", "evidence_ids": [], "scene_action": None}
                            )
                        }
                    }
                ]
            }
        ).encode()


def test_chat_uses_provider_for_greeting_without_evidence() -> None:
    provider = RecordingProvider()
    service = AgentService(settings=Settings(), provider=provider)

    response = asyncio.run(service.chat(ChatRequest(message="你好")))

    assert provider.calls == 1
    assert response.answer == "你好，我是浮玉客。"
    assert response.citations == []
    assert response.mode == "model"


def test_chat_has_local_identity_fallback_without_evidence() -> None:
    service = AgentService(settings=Settings(), provider=FailingProvider())

    response = asyncio.run(service.chat(ChatRequest(message="你是谁")))

    assert response.citations == []
    assert "浮玉客" in response.answer
    assert response.mode == "demo"


def test_provider_retries_without_response_format_after_compatibility_rejection() -> None:
    provider = StructuredOutputRejectingProvider()

    answer = asyncio.run(provider.complete(system="test", evidence=[], message="你好", history=[]))

    assert answer.answer == "你好"
    assert "response_format" in provider.payloads[0]
    assert "response_format" not in provider.payloads[1]
