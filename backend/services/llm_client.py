"""
Config-driven LLM client for SentiWatch.

Resolves a provider at call time:
  - If AGENTROUTER_BASE_URL + AGENTROUTER_API_KEY are set -> use the OpenAI SDK
    pointed at AgentRouter (OpenAI-compatible gateway, OpenRouter-style).
  - Otherwise -> fall back to the existing Groq client.

This lets the live service keep working with zero config, while a switch to
AgentRouter is just a matter of setting env vars in Render — no code change.

Per-task model selection via env vars so cheap vs. frontier models can differ:
  - RELEVANCE_MODEL      (cheap, high-volume gatekeeping)
  - SENTIMENT_MODEL      (balanced, per-mention analysis)
  - RECOMMENDATION_MODEL (stronger, low-volume reasoning)
"""

import os
import json
import logging
import time
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()

# ── Provider configuration ─────────────────────────────────────────────
AGENTROUTER_BASE_URL = os.getenv("AGENTROUTER_BASE_URL")
AGENTROUTER_API_KEY = os.getenv("AGENTROUTER_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Per-task model ids. Defaults keep the current Groq behavior when AgentRouter
# is not configured. Override any of these in the environment.
DEFAULT_GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
RELEVANCE_MODEL = os.getenv("RELEVANCE_MODEL", DEFAULT_GROQ_MODEL)
SENTIMENT_MODEL = os.getenv("SENTIMENT_MODEL", DEFAULT_GROQ_MODEL)
RECOMMENDATION_MODEL = os.getenv("RECOMMENDATION_MODEL", DEFAULT_GROQ_MODEL)

MAX_RETRIES = 3


def _use_agentrouter() -> bool:
    """AgentRouter is active only when both its URL and key are present."""
    return bool(AGENTROUTER_BASE_URL and AGENTROUTER_API_KEY)


def active_provider() -> str:
    """Human-readable name of the provider that will be used. For logging."""
    return "agentrouter" if _use_agentrouter() else "groq"


# Lazily-built singleton clients so import never fails on a missing SDK/key.
_agentrouter_client = None
_groq_client = None


def _get_agentrouter_client():
    global _agentrouter_client
    if _agentrouter_client is None:
        # Imported lazily so environments without the openai SDK still load
        # this module (Groq fallback path stays available).
        from openai import OpenAI
        _agentrouter_client = OpenAI(
            base_url=AGENTROUTER_BASE_URL,
            api_key=AGENTROUTER_API_KEY,
        )
    return _agentrouter_client


def _get_groq_client():
    global _groq_client
    if _groq_client is None:
        from groq import Groq
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


def chat_json(
    system: str,
    user: str,
    model: Optional[str] = None,
    temperature: float = 0,
) -> Dict[str, Any]:
    """
    Send a system+user prompt and return parsed JSON.

    Both AgentRouter (OpenAI SDK) and Groq expose the same
    chat.completions.create + response_format={"type":"json_object"} shape,
    so the call is identical across providers.

    Raises on repeated failure so callers can decide how to fall back.
    """
    use_router = _use_agentrouter()
    client = _get_agentrouter_client() if use_router else _get_groq_client()
    resolved_model = model or (SENTIMENT_MODEL if use_router else DEFAULT_GROQ_MODEL)

    last_err: Optional[Exception] = None
    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model=resolved_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            return json.loads(content)
        except Exception as e:  # noqa: BLE001 - surface after retries
            last_err = e
            logging.warning(
                "LLM attempt %d/%d failed (provider=%s, model=%s): %s",
                attempt + 1, MAX_RETRIES, active_provider(), resolved_model, e,
            )
            time.sleep(2)

    raise RuntimeError(f"LLM call failed after {MAX_RETRIES} retries: {last_err}")
