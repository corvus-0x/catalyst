from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import anthropic

logger = logging.getLogger("catalyst.ai_gateway")

MODEL_HAIKU = "claude-haiku-4-5-20251001"
MODEL_SONNET = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 4096
MAX_ATTEMPTS = 3
BACKOFF_BASE = 2.0

_API_KEY: str | None = None


@dataclass
class AiCallResult:
    payload: dict[str, Any] | None
    raw_text: str
    model: str
    input_tokens: int
    output_tokens: int
    error: str | None = None


def _get_api_key() -> str:
    global _API_KEY
    if _API_KEY is None:
        _API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    if not _API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set.")
    return _API_KEY


def _get_client():
    return anthropic.Anthropic(api_key=_get_api_key())


def strip_json_fences(raw: str) -> str:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        lines = [
            line
            for line in cleaned.splitlines()
            if not line.strip().startswith("```")
        ]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _empty_error(model: str, error: str) -> AiCallResult:
    return AiCallResult(
        payload=None,
        raw_text="",
        model=model,
        input_tokens=0,
        output_tokens=0,
        error=error,
    )


def call_json(
    *,
    system: str,
    user_message: str,
    model: str,
    temperature: float,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> AiCallResult:
    client = _get_client()
    last_exc: Exception | None = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                messages=[{"role": "user", "content": user_message}],
            )
            raw = response.content[0].text or ""
            try:
                payload = json.loads(strip_json_fences(raw))
            except (TypeError, ValueError):
                logger.warning("AI returned non-JSON response: %s", raw[:200])
                return AiCallResult(
                    payload=None,
                    raw_text=raw,
                    model=model,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    error="AI returned non-JSON response",
                )
            return AiCallResult(
                payload=payload,
                raw_text=raw,
                model=model,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            )
        except (
            anthropic.RateLimitError,
            anthropic.APIConnectionError,
            anthropic.APITimeoutError,
            anthropic.InternalServerError,
        ) as exc:
            last_exc = exc
            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_BASE**attempt)
                continue
        except Exception as exc:  # noqa: BLE001
            logger.exception("AI call failed: %s", exc)
            return _empty_error(model, str(exc))

    logger.error("AI call failed after %d attempts: %s", MAX_ATTEMPTS, last_exc)
    return _empty_error(model, f"Claude API unavailable after {MAX_ATTEMPTS} attempts")
