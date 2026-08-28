import asyncio
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")

from services import crisis_agent  # noqa: E402


VALID_OUTPUT = {
    "incident_title": "Payment delays are driving customer concern",
    "summary": "Recent verified complaints indicate delayed settlements.",
    "severity": "high",
    "root_cause_hypothesis": "A settlement-processing bottleneck may be responsible.",
    "evidence_summary": "Three recent complaints report delayed payment access.",
    "recommended_actions": [
        "Confirm the affected settlement window with operations.",
        "Issue a factual holding statement with the next update time.",
    ],
    "draft_public_response": "We are investigating delayed settlements and will update customers shortly.",
    "confidence": 0.82,
    "citations": [
        {"reference_id": "mention-a", "relevance": "Documents a recent delay."}
    ],
}

BRIEF = {
    "id": "brief-a",
    "entity_id": "entity-a",
    "risk_snapshot_id": "snapshot-a",
    "event_type": "risk_threshold",
    "severity": "high",
    "status": "pending",
}

CONTEXT = {
    "entity": {"id": "entity-a", "name": "Example", "profile_type": "business"},
    "risk_snapshot": {"id": "snapshot-a", "score": 68, "status": "high"},
    "evidence": [],
    "references": {
        "snapshot-a": {
            "type": "risk_snapshot",
            "source": "SentiWatch risk engine",
            "url": None,
        },
        "mention-a": {
            "type": "mention",
            "source": "Nigerian News Feed",
            "url": "https://example.com/report",
        },
    },
}


class CrisisAgentTests(unittest.TestCase):
    def test_valid_pending_brief_invokes_agent_and_completes(self):
        claimed = {**BRIEF, "status": "running"}
        with patch.object(crisis_agent, "_load_crisis_brief", return_value=BRIEF), patch.object(
            crisis_agent, "_claim_crisis_brief", return_value=claimed
        ), patch.object(
            crisis_agent, "_load_evidence_context", return_value=CONTEXT
        ), patch.object(
            crisis_agent, "_invoke_adk_agent", new=AsyncMock(return_value=VALID_OUTPUT)
        ) as invoke, patch.object(
            crisis_agent, "_persist_completed_brief", return_value=True
        ) as persist:
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result["status"], "completed")
        invoke.assert_awaited_once_with(CONTEXT)
        persisted_output = persist.call_args.args[1]
        self.assertIsInstance(persisted_output, crisis_agent.CrisisAgentOutput)
        self.assertEqual(persisted_output.confidence, 0.82)

    def test_running_brief_is_ignored(self):
        with patch.object(
            crisis_agent, "_load_crisis_brief", return_value={**BRIEF, "status": "running"}
        ), patch.object(crisis_agent, "_claim_crisis_brief") as claim:
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result, {"status": "ignored", "reason": "already_running"})
        claim.assert_not_called()

    def test_completed_brief_is_ignored(self):
        with patch.object(
            crisis_agent, "_load_crisis_brief", return_value={**BRIEF, "status": "completed"}
        ), patch.object(crisis_agent, "_claim_crisis_brief") as claim:
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result, {"status": "ignored", "reason": "already_completed"})
        claim.assert_not_called()

    def test_failed_brief_retries_in_place(self):
        failed = {**BRIEF, "status": "failed"}
        claimed = {**BRIEF, "status": "running"}
        with patch.object(crisis_agent, "_load_crisis_brief", return_value=failed), patch.object(
            crisis_agent, "_claim_crisis_brief", return_value=claimed
        ) as claim, patch.object(
            crisis_agent, "_load_evidence_context", return_value=CONTEXT
        ), patch.object(
            crisis_agent, "_invoke_adk_agent", new=AsyncMock(return_value=VALID_OUTPUT)
        ), patch.object(crisis_agent, "_persist_completed_brief", return_value=True):
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result["status"], "completed")
        claim.assert_called_once_with(failed)

    def test_structured_output_is_validated_and_citations_are_enriched(self):
        output, citations = crisis_agent._validate_agent_output(
            VALID_OUTPUT, CONTEXT["references"]
        )

        self.assertEqual(output.severity, "high")
        self.assertEqual(citations, [{
            "reference_id": "mention-a",
            "type": "mention",
            "source": "Nigerian News Feed",
            "url": "https://example.com/report",
            "relevance": "Documents a recent delay.",
        }])

    def test_unknown_citation_is_rejected(self):
        malformed = {
            **VALID_OUTPUT,
            "citations": [{"reference_id": "unknown", "relevance": "Unsupported."}],
        }
        with self.assertRaises(crisis_agent.CrisisAgentOutputError):
            crisis_agent._validate_agent_output(malformed, CONTEXT["references"])

    def test_malformed_output_marks_brief_failed(self):
        with patch.object(crisis_agent, "_load_crisis_brief", return_value=BRIEF), patch.object(
            crisis_agent, "_claim_crisis_brief", return_value={**BRIEF, "status": "running"}
        ), patch.object(
            crisis_agent, "_load_evidence_context", return_value=CONTEXT
        ), patch.object(
            crisis_agent, "_invoke_adk_agent", new=AsyncMock(return_value={"summary": "incomplete"})
        ), patch.object(crisis_agent, "_persist_failed_brief", return_value=True) as failed:
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result["code"], "invalid_output")
        failed.assert_called_once_with(
            "brief-a",
            "invalid_output",
            "Crisis agent returned invalid structured output.",
        )

    def test_api_failure_marks_brief_failed(self):
        with patch.object(crisis_agent, "_load_crisis_brief", return_value=BRIEF), patch.object(
            crisis_agent, "_claim_crisis_brief", return_value={**BRIEF, "status": "running"}
        ), patch.object(
            crisis_agent, "_load_evidence_context", return_value=CONTEXT
        ), patch.object(
            crisis_agent, "_invoke_adk_agent", new=AsyncMock(side_effect=RuntimeError("provider"))
        ), patch.object(crisis_agent, "_persist_failed_brief", return_value=True) as failed:
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result["code"], "agent_failed")
        self.assertNotIn("provider", failed.call_args.args[2])

    def test_timeout_marks_brief_failed(self):
        with patch.object(crisis_agent, "_load_crisis_brief", return_value=BRIEF), patch.object(
            crisis_agent, "_claim_crisis_brief", return_value={**BRIEF, "status": "running"}
        ), patch.object(
            crisis_agent, "_load_evidence_context", return_value=CONTEXT
        ), patch.object(
            crisis_agent, "_invoke_adk_agent", new=AsyncMock(side_effect=asyncio.TimeoutError)
        ), patch.object(crisis_agent, "_persist_failed_brief", return_value=True) as failed:
            result = crisis_agent.process_crisis_brief("brief-a")

        self.assertEqual(result["code"], "timeout")
        self.assertEqual(failed.call_args.args[1], "timeout")

    def test_success_persists_every_required_crisis_field(self):
        output, citations = crisis_agent._validate_agent_output(
            VALID_OUTPUT, CONTEXT["references"]
        )
        query = MagicMock()
        query.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "brief-a", "status": "completed"}
        ]
        admin = MagicMock()
        admin.table.return_value = query

        with patch.object(crisis_agent, "supabase_admin", admin):
            persisted = crisis_agent._persist_completed_brief("brief-a", output, citations)

        self.assertTrue(persisted)
        payload = query.update.call_args.args[0]
        for field in (
            "incident_title", "summary", "severity", "root_cause_hypothesis",
            "evidence_summary", "recommended_actions", "draft_public_response",
            "confidence", "citations", "completed_at",
        ):
            self.assertIn(field, payload)
        self.assertEqual(payload["status"], "completed")

    def test_atomic_claim_does_not_insert_a_duplicate_brief(self):
        query = MagicMock()
        query.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {**BRIEF, "status": "running"}
        ]
        admin = MagicMock()
        admin.table.return_value = query

        with patch.object(crisis_agent, "supabase_admin", admin):
            claimed = crisis_agent._claim_crisis_brief(BRIEF)

        self.assertEqual(claimed["status"], "running")
        query.update.assert_called_once()
        query.insert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
