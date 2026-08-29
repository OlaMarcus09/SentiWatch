import asyncio
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")

import cron_sync  # noqa: E402
import main as api_main  # noqa: E402


def crisis_query(rows):
    query = MagicMock()
    (
        query.select.return_value
        .eq.return_value
        .eq.return_value
        .order.return_value
        .limit.return_value
        .execute.return_value
    ).data = rows
    return query


def crisis_admin(pending_rows, failed_rows=None):
    pending_query = crisis_query(pending_rows)
    admin = MagicMock()
    if failed_rows is None or pending_rows:
        admin.table.return_value = pending_query
        failed_query = None
    else:
        failed_query = crisis_query(failed_rows)
        admin.table.side_effect = [pending_query, failed_query]
    return admin, pending_query, failed_query


def cron_admin():
    entities_query = MagicMock()
    entities_query.select.return_value.execute.return_value.data = [
        {"id": "entity-a", "name": "Example", "social_handle": None}
    ]
    active_query = MagicMock()
    active_query.select.return_value.eq.return_value.gt.return_value.execute.return_value.data = []
    admin = MagicMock()
    admin.table.side_effect = [entities_query, active_query]
    return admin


class CrisisPipelineEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api_main.app)

    def test_authenticated_request_processes_pending_brief(self):
        admin, _query, _failed_query = crisis_admin([{"id": "brief-a"}])
        with patch.object(api_main, "INTERNAL_API_KEY", "test-key"), patch.object(
            api_main, "supabase_admin", admin
        ), patch.object(
            api_main,
            "process_crisis_brief",
            return_value={"status": "completed", "crisis_brief_id": "brief-a"},
        ) as process:
            response = self.client.post(
                "/internal/process-crisis/entity-a",
                headers={"X-Internal-Key": "test-key"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "found": True,
            "crisis_brief_id": "brief-a",
            "status": "completed",
        })
        process.assert_called_once_with("brief-a")

    def test_unauthenticated_request_is_rejected(self):
        admin = MagicMock()
        with patch.object(api_main, "INTERNAL_API_KEY", "test-key"), patch.object(
            api_main, "supabase_admin", admin
        ):
            response = self.client.post("/internal/process-crisis/entity-a")

        self.assertEqual(response.status_code, 401)
        admin.table.assert_not_called()

    def test_user_bearer_token_cannot_authorize_internal_crisis_processing(self):
        admin = MagicMock()
        with patch.object(api_main, "INTERNAL_API_KEY", "test-key"), patch.object(
            api_main, "supabase_admin", admin
        ):
            response = self.client.post(
                "/internal/process-crisis/entity-b",
                headers={"Authorization": "Bearer ordinary-user-token"},
            )

        self.assertEqual(response.status_code, 401)
        admin.table.assert_not_called()

    def test_no_pending_brief_is_a_safe_noop(self):
        admin, _query, _failed_query = crisis_admin([], [])
        with patch.object(api_main, "INTERNAL_API_KEY", "test-key"), patch.object(
            api_main, "supabase_admin", admin
        ), patch.object(api_main, "process_crisis_brief") as process:
            response = self.client.post(
                "/internal/process-crisis/entity-a",
                headers={"X-Internal-Key": "test-key"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "found": False,
            "crisis_brief_id": None,
            "status": "no_pending_brief",
        })
        process.assert_not_called()

    def test_processing_runs_via_asyncio_to_thread(self):
        admin, _query, _failed_query = crisis_admin([{"id": "brief-a"}])
        with patch.object(api_main, "supabase_admin", admin), patch.object(
            api_main.asyncio,
            "to_thread",
            new=AsyncMock(return_value={"status": "completed"}),
        ) as to_thread:
            result = asyncio.run(api_main.trigger_crisis_processing("entity-a"))

        self.assertEqual(result["status"], "completed")
        to_thread.assert_awaited_once_with(api_main.process_crisis_brief, "brief-a")

    def test_concurrent_invocations_complete_the_brief_only_once(self):
        admin, _query, _failed_query = crisis_admin([{"id": "brief-a"}])
        outcomes = [
            {"status": "completed", "crisis_brief_id": "brief-a"},
            {"status": "ignored", "reason": "concurrent_claim"},
        ]
        with patch.object(api_main, "supabase_admin", admin), patch.object(
            api_main.asyncio,
            "to_thread",
            new=AsyncMock(side_effect=outcomes),
        ) as to_thread:
            async def invoke_twice():
                return await asyncio.gather(
                    api_main.trigger_crisis_processing("entity-a"),
                    api_main.trigger_crisis_processing("entity-a"),
                )

            results = asyncio.run(invoke_twice())

        self.assertEqual([result["status"] for result in results].count("completed"), 1)
        self.assertEqual([result["status"] for result in results].count("ignored"), 1)
        self.assertEqual(to_thread.await_count, 2)

    def test_failed_brief_can_be_retried(self):
        admin, pending_query, failed_query = crisis_admin([], [{"id": "brief-failed"}])
        with patch.object(api_main, "supabase_admin", admin), patch.object(
            api_main.asyncio,
            "to_thread",
            new=AsyncMock(return_value={"status": "completed"}),
        ):
            result = asyncio.run(api_main.trigger_crisis_processing("entity-a"))

        self.assertEqual(result["status"], "completed")
        pending_query.select.return_value.eq.return_value.eq.assert_called_once_with(
            "status", "pending"
        )
        failed_query.select.return_value.eq.return_value.eq.assert_called_once_with(
            "status", "failed"
        )

    def test_completed_brief_is_not_reprocessed(self):
        admin, pending_query, failed_query = crisis_admin([], [])
        with patch.object(api_main, "supabase_admin", admin), patch.object(
            api_main, "process_crisis_brief"
        ) as process:
            result = asyncio.run(api_main.trigger_crisis_processing("entity-a"))

        self.assertEqual(result["status"], "no_pending_brief")
        pending_query.select.return_value.eq.return_value.eq.assert_called_once_with(
            "status", "pending"
        )
        failed_query.select.return_value.eq.return_value.eq.assert_called_once_with(
            "status", "failed"
        )
        process.assert_not_called()

    def test_calculate_risk_response_contract_is_unchanged(self):
        expected = {
            "entity": "Example",
            "risk_score": 68,
            "status": "high",
            "crisis_brief_created": True,
        }
        with patch.object(api_main, "_require_entity"), patch.object(
            api_main, "_record_pipeline_run"
        ), patch.object(api_main, "calculate_risk_and_alert", return_value=expected):
            result = api_main.trigger_risk_calculation("entity-a")

        self.assertIs(result, expected)


class ReadinessEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api_main.app)

    def test_readiness_requires_google_api_key(self):
        configured = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE": "test-service-role",
            "INTERNAL_API_KEY": "test-internal-key",
            "GROQ_API_KEY": "test-groq-key",
        }
        admin = MagicMock()
        with patch.dict(os.environ, configured, clear=True), patch.object(
            api_main, "supabase_admin", admin
        ):
            response = self.client.get("/health/ready")

        self.assertEqual(response.status_code, 503)
        admin.table.assert_not_called()

    def test_readiness_succeeds_with_required_configuration(self):
        configured = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE": "test-service-role",
            "INTERNAL_API_KEY": "test-internal-key",
            "GOOGLE_API_KEY": "test-google-key",
            "GROQ_API_KEY": "test-groq-key",
        }
        admin = MagicMock()
        with patch.dict(os.environ, configured, clear=True), patch.object(
            api_main, "supabase_admin", admin
        ):
            response = self.client.get("/health/ready")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready"})
        admin.table.assert_called_once_with("monitored_entities")


class CrisisPipelineCronTests(unittest.TestCase):
    def test_crisis_stage_runs_after_successful_risk_calculation(self):
        recovery = MagicMock(status_code=200)
        recovery.json.return_value = {"entity_ids": []}
        paths = []

        def run_stage(path, _entity, _timeout, _pipeline):
            paths.append(path)
            if path.startswith("/sync/"):
                return {"pipeline_run_id": "run-a", "worker_token": "token-a"}
            return {}

        with patch.object(cron_sync, "INTERNAL_API_KEY", "test-key"), patch.object(
            cron_sync, "require_supabase_admin", return_value=cron_admin()
        ), patch.object(cron_sync, "wait_for_backend", return_value=True), patch.object(
            cron_sync.requests, "post", return_value=recovery
        ), patch.object(cron_sync, "_post_stage", side_effect=run_stage):
            summary = cron_sync.run_automated_pipeline()

        self.assertEqual(summary.succeeded, 1)
        self.assertEqual(paths, [
            "/sync/entity-a",
            "/analyze",
            "/calculate-risk/entity-a",
            "/internal/process-crisis/entity-a",
        ])

    def test_crisis_stage_is_skipped_when_risk_calculation_fails(self):
        recovery = MagicMock(status_code=200)
        recovery.json.return_value = {"entity_ids": []}
        paths = []

        def run_stage(path, _entity, _timeout, _pipeline):
            paths.append(path)
            if path.startswith("/sync/"):
                return {"pipeline_run_id": "run-a", "worker_token": "token-a"}
            if path.startswith("/calculate-risk/"):
                return False
            return {}

        with patch.object(cron_sync, "INTERNAL_API_KEY", "test-key"), patch.object(
            cron_sync, "require_supabase_admin", return_value=cron_admin()
        ), patch.object(cron_sync, "wait_for_backend", return_value=True), patch.object(
            cron_sync.requests, "post", return_value=recovery
        ), patch.object(cron_sync, "_post_stage", side_effect=run_stage):
            summary = cron_sync.run_automated_pipeline()

        self.assertEqual(summary.failed, 1)
        self.assertEqual(paths, [
            "/sync/entity-a",
            "/analyze",
            "/calculate-risk/entity-a",
        ])


if __name__ == "__main__":
    unittest.main()
