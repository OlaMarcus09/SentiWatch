"""Isolated Google ADK workflow for one persisted SentiWatch crisis brief."""

from __future__ import annotations

import asyncio
from contextlib import aclosing
from datetime import datetime, timezone
import json
import logging
import os
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from database import supabase_admin


logger = logging.getLogger(__name__)

CRISIS_AGENT_MODEL = os.getenv("CRISIS_AGENT_MODEL", "gemini-3.5-flash")
CRISIS_AGENT_TIMEOUT_SECONDS = max(
    5, int(os.getenv("CRISIS_AGENT_TIMEOUT_SECONDS", "45"))
)
CRISIS_AGENT_EVIDENCE_LIMIT = max(
    1, min(50, int(os.getenv("CRISIS_AGENT_EVIDENCE_LIMIT", "20")))
)


class CrisisCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reference_id: str = Field(min_length=1, max_length=120)
    relevance: str = Field(min_length=1, max_length=500)


class CrisisAgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incident_title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=3000)
    severity: Literal["high", "critical"]
    root_cause_hypothesis: str = Field(min_length=1, max_length=3000)
    evidence_summary: str = Field(min_length=1, max_length=5000)
    recommended_actions: list[str] = Field(min_length=1, max_length=8)
    draft_public_response: str = Field(min_length=1, max_length=5000)
    confidence: float = Field(ge=0, le=1)
    citations: list[CrisisCitation] = Field(min_length=1, max_length=12)

    @field_validator("recommended_actions")
    @classmethod
    def validate_actions(cls, actions: list[str]) -> list[str]:
        cleaned = [str(action).strip() for action in actions]
        if any(not action or len(action) > 1000 for action in cleaned):
            raise ValueError("recommended actions must be non-empty and bounded")
        return cleaned


class CrisisAgentOutputError(ValueError):
    """The agent response did not satisfy the persisted crisis schema."""


def _load_crisis_brief(crisis_brief_id: str) -> dict | None:
    result = (
        supabase_admin.table("crisis_briefs")
        .select("*")
        .eq("id", crisis_brief_id)
        .maybe_single()
        .execute()
    )
    return result.data or None


def _claim_crisis_brief(brief: dict) -> dict | None:
    """Atomically claim one pending or failed brief for this invocation."""
    current_status = brief.get("status")
    if current_status not in {"pending", "failed"}:
        return None

    now = datetime.now(timezone.utc).isoformat()
    result = (
        supabase_admin.table("crisis_briefs")
        .update({
            "status": "running",
            "error_message": None,
            "error_details": {},
            "completed_at": None,
            "updated_at": now,
        })
        .eq("id", brief["id"])
        .eq("status", current_status)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def _load_evidence_context(brief: dict) -> dict:
    entity_id = brief["entity_id"]
    snapshot_id = brief["risk_snapshot_id"]

    snapshot = (
        supabase_admin.table("risk_scores")
        .select(
            "id, entity_id, score, status, negative_mentions, positive_mentions, "
            "neutral_mentions, category_breakdown, root_cause_summary, created_at"
        )
        .eq("id", snapshot_id)
        .eq("entity_id", entity_id)
        .maybe_single()
        .execute()
    ).data
    if not snapshot:
        raise RuntimeError("triggering risk snapshot is unavailable")

    entity = (
        supabase_admin.table("monitored_entities")
        .select("id, name, profile_type")
        .eq("id", entity_id)
        .maybe_single()
        .execute()
    ).data
    if not entity:
        raise RuntimeError("monitored entity is unavailable")

    mentions = (
        supabase_admin.table("mentions")
        .select("id, source, content, url, created_at, published_at")
        .eq("entity_id", entity_id)
        .eq("status", "processed")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    ).data or []
    mention_by_id = {str(row["id"]): row for row in mentions}

    sentiment_rows = []
    if mention_by_id:
        sentiment_rows = (
            supabase_admin.table("sentiment_results")
            .select(
                "mention_id, label, confidence, severity, category, sub_category, "
                "risk_level, root_cause, reason"
            )
            .in_("mention_id", list(mention_by_id))
            .eq("label", "negative")
            .order("severity", desc=True)
            .limit(CRISIS_AGENT_EVIDENCE_LIMIT)
            .execute()
        ).data or []

    evidence = []
    references = {
        str(snapshot["id"]): {
            "type": "risk_snapshot",
            "source": "SentiWatch risk engine",
            "url": None,
        }
    }
    for sentiment in sentiment_rows:
        mention_id = str(sentiment["mention_id"])
        mention = mention_by_id.get(mention_id)
        if not mention:
            continue
        references[mention_id] = {
            "type": "mention",
            "source": mention.get("source") or "Unknown",
            "url": mention.get("url"),
        }
        evidence.append({
            "reference_id": mention_id,
            "source": mention.get("source"),
            "content": str(mention.get("content") or "")[:2000],
            "url": mention.get("url"),
            "created_at": mention.get("published_at") or mention.get("created_at"),
            "sentiment": {
                "severity": sentiment.get("severity"),
                "confidence": sentiment.get("confidence"),
                "category": sentiment.get("category"),
                "sub_category": sentiment.get("sub_category"),
                "risk_level": sentiment.get("risk_level"),
                "root_cause": sentiment.get("root_cause"),
                "reason": sentiment.get("reason"),
            },
        })

    return {
        "brief": {
            "id": brief["id"],
            "event_type": brief["event_type"],
            "severity": brief["severity"],
        },
        "entity": entity,
        "risk_snapshot": snapshot,
        "evidence": evidence,
        "references": references,
    }


CRISIS_AGENT_INSTRUCTION = """
You are SentiWatch's focused crisis-response investigator for Nigerian brands.
The deterministic SentiWatch risk engine has already identified a HIGH or
CRITICAL event. Investigate only the supplied evidence and produce a practical
crisis brief. Do not recalculate or modify the risk score or sentiment labels.
Do not claim facts that are absent from the supplied evidence. Distinguish a
hypothesis from a confirmed fact. Recommended actions must be concrete and
proportionate. The public response must be a draft, not a published statement.
Every citation reference_id must exactly match one supplied reference_id.
""".strip()


async def _invoke_adk_agent(context: dict) -> Any:
    if not os.getenv("GOOGLE_API_KEY"):
        raise RuntimeError("Google Gemini API is not configured")

    # Lazy imports keep the existing Groq/risk pipeline import path independent
    # from ADK initialization and make unit tests fully provider-free.
    from google.adk import Agent, Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    agent = Agent(
        name="sentiwatch_crisis_agent",
        model=CRISIS_AGENT_MODEL,
        instruction=CRISIS_AGENT_INSTRUCTION,
        output_schema=CrisisAgentOutput,
        include_contents="none",
        tools=[],
        generate_content_config=types.GenerateContentConfig(temperature=0.1),
    )
    runner = Runner(
        agent=agent,
        app_name="sentiwatch_crisis_response",
        session_service=InMemorySessionService(),
        auto_create_session=True,
    )
    message = types.Content(
        role="user",
        parts=[types.Part(text=json.dumps(context, default=str))],
    )

    final_text = None
    async with runner:
        async with aclosing(runner.run_async(
            user_id=str(context["entity"]["id"]),
            session_id=str(uuid.uuid4()),
            new_message=message,
        )) as events:
            async for event in events:
                if event.author != agent.name or not event.is_final_response():
                    continue
                if event.content and event.content.parts:
                    text = "".join(
                        part.text or "" for part in event.content.parts if not part.thought
                    ).strip()
                    if text:
                        final_text = text

    if not final_text:
        raise CrisisAgentOutputError("agent returned no structured response")
    return final_text


def _validate_agent_output(
    raw_output: Any,
    references: dict,
) -> tuple[CrisisAgentOutput, list[dict]]:
    try:
        if isinstance(raw_output, str):
            output = CrisisAgentOutput.model_validate_json(raw_output)
        else:
            output = CrisisAgentOutput.model_validate(raw_output)
    except (ValidationError, ValueError, TypeError) as exc:
        raise CrisisAgentOutputError("invalid structured crisis output") from exc

    citations = []
    for citation in output.citations:
        reference = references.get(citation.reference_id)
        if not reference:
            raise CrisisAgentOutputError("crisis output cited unknown evidence")
        citations.append({
            "reference_id": citation.reference_id,
            "type": reference["type"],
            "source": reference["source"],
            "url": reference.get("url"),
            "relevance": citation.relevance,
        })
    return output, citations


def _persist_completed_brief(
    crisis_brief_id: str,
    output: CrisisAgentOutput,
    citations: list[dict],
) -> bool:
    completed_at = datetime.now(timezone.utc).isoformat()
    result = (
        supabase_admin.table("crisis_briefs")
        .update({
            "status": "completed",
            "incident_title": output.incident_title,
            "summary": output.summary,
            "severity": output.severity,
            "root_cause_hypothesis": output.root_cause_hypothesis,
            "evidence_summary": output.evidence_summary,
            "recommended_actions": output.recommended_actions,
            "draft_public_response": output.draft_public_response,
            "confidence": output.confidence,
            "citations": citations,
            "error_message": None,
            "error_details": {},
            "updated_at": completed_at,
            "completed_at": completed_at,
        })
        .eq("id", crisis_brief_id)
        .eq("status", "running")
        .execute()
    )
    return bool(result.data)


def _persist_failed_brief(crisis_brief_id: str, code: str, message: str) -> bool:
    failed_at = datetime.now(timezone.utc).isoformat()
    try:
        result = (
            supabase_admin.table("crisis_briefs")
            .update({
                "status": "failed",
                "error_message": message,
                "error_details": {"code": code},
                "updated_at": failed_at,
                "completed_at": failed_at,
            })
            .eq("id", crisis_brief_id)
            .eq("status", "running")
            .execute()
        )
        return bool(result.data)
    except Exception:
        logger.error("Could not persist crisis-agent failure for brief %s", crisis_brief_id)
        return False


def process_crisis_brief(crisis_brief_id: str) -> dict:
    """Process one pending/failed brief; running and completed rows are no-ops."""
    try:
        brief = _load_crisis_brief(crisis_brief_id)
    except Exception:
        logger.error("Could not load crisis brief %s", crisis_brief_id)
        return {"status": "failed", "code": "load_failed"}

    if not brief:
        return {"status": "ignored", "reason": "not_found"}
    if brief.get("status") in {"running", "completed"}:
        return {"status": "ignored", "reason": f"already_{brief['status']}"}
    if brief.get("status") not in {"pending", "failed"}:
        return {"status": "ignored", "reason": "not_runnable"}

    try:
        claimed = _claim_crisis_brief(brief)
    except Exception:
        logger.error("Could not claim crisis brief %s", crisis_brief_id)
        return {"status": "failed", "code": "claim_failed"}
    if not claimed:
        return {"status": "ignored", "reason": "concurrent_claim"}

    try:
        context = _load_evidence_context(claimed)
        raw_output = asyncio.run(asyncio.wait_for(
            _invoke_adk_agent(context),
            timeout=CRISIS_AGENT_TIMEOUT_SECONDS,
        ))
        output, citations = _validate_agent_output(raw_output, context["references"])
        if not _persist_completed_brief(crisis_brief_id, output, citations):
            raise RuntimeError("brief state changed before completion")
        return {"status": "completed", "crisis_brief_id": crisis_brief_id}
    except TimeoutError:
        code = "timeout"
        message = "Crisis agent timed out. The same brief can be retried safely."
    except CrisisAgentOutputError:
        code = "invalid_output"
        message = "Crisis agent returned invalid structured output."
    except Exception:
        code = "agent_failed"
        message = "Crisis agent execution failed. The same brief can be retried safely."

    logger.warning("Crisis agent failed for brief %s with code %s", crisis_brief_id, code)
    _persist_failed_brief(crisis_brief_id, code, message)
    return {"status": "failed", "code": code, "crisis_brief_id": crisis_brief_id}
