"""OpenAI-compatible LLM client for the DSH (DeepSeek harness) runtime.

Bring-your-own model access per the spec:
- Default: the local bridge (services/llm-bridge, backed by z-ai-web-dev-sdk)
  at http://127.0.0.1:8100/v1
- Production: point KK_LLM_BASE_URL at https://api.deepseek.com and set
  KK_LLM_API_KEY. No model keys are ever hard-coded or logged.
If the LLM is unavailable / times out, the orchestrator falls back to
deterministic behavior - never blocks gameplay.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

from app.core.config import settings


@dataclass(slots=True)
class LLMResult:
    ok: bool
    content: str = ""
    error: str = ""
    usage: dict = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.usage is None:
            self.usage = {}


class DSHLLMClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=settings.llm_base_url.rstrip("/"),
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                timeout=httpx.Timeout(settings.llm_timeout_seconds),
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def chat_json(self, system: str, user: str) -> LLMResult:
        """Request a JSON-only completion. Returns LLMResult.ok=False on any
        failure - the orchestrator treats that as 'model unavailable'."""
        if not settings.llm_enabled:
            return LLMResult(ok=False, error="llm_disabled_by_config")
        try:
            client = await self._get_client()
            resp = await client.post(
                "/chat/completions",
                json={
                    "model": settings.llm_model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": 0.6,
                    "max_tokens": 700,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if not content.strip():
                return LLMResult(ok=False, error="empty_completion")
            return LLMResult(ok=True, content=content, usage=data.get("usage") or {})
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            return LLMResult(ok=False, error=f"llm_unavailable: {type(exc).__name__}")

    async def chat(self, messages: list[dict[str, str]], max_tokens: int = 350, temperature: float = 0.5) -> LLMResult:
        """Plain multi-turn chat completion (used by the in-game Ask helper)."""
        if not settings.llm_enabled:
            return LLMResult(ok=False, error="llm_disabled_by_config")
        try:
            client = await self._get_client()
            resp = await client.post(
                "/chat/completions",
                json={"model": settings.llm_model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
            )
            resp.raise_for_status()
            data = resp.json()
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if not content.strip():
                return LLMResult(ok=False, error="empty_completion")
            return LLMResult(ok=True, content=content.strip(), usage=data.get("usage") or {})
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            return LLMResult(ok=False, error=f"llm_unavailable: {type(exc).__name__}")

    @staticmethod
    def extract_json(text: str) -> dict | None:
        """Robustly pull the first JSON object out of a possibly chatty reply."""
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None


llm_client = DSHLLMClient()
