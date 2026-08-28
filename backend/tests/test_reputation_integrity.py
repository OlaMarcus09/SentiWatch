import os
import re
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Backend modules construct clients at import time. Placeholder credentials are
# sufficient because these unit tests mock every database operation.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")

try:
    import resend  # noqa: F401
except ModuleNotFoundError:
    # Keep the unit suite runnable in lightweight environments; these tests do
    # not exercise email delivery.
    sys.modules["resend"] = types.SimpleNamespace(
        api_key=None,
        Emails=types.SimpleNamespace(send=lambda *_args, **_kwargs: None),
    )

import risk_engine  # noqa: E402
import scrapers  # noqa: E402
import scoring  # noqa: E402
import sentiment  # noqa: E402
import constants  # noqa: E402
import main as api_main  # noqa: E402
import cron_sync  # noqa: E402
from services import llm_client  # noqa: E402


class QueryDouble:
    def __init__(self, data=None):
        self.data = data or []
        self.filters = []
        self.inserted = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def gte(self, column, value):
        self.filters.append((f"{column}__gte", value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def in_(self, column, value):
        self.filters.append((f"{column}__in", value))
        return self

    def insert(self, payload):
        self.inserted = payload
        return self

    def execute(self):
        return MagicMock(data=self.data)


class ReputationIntegrityTests(unittest.TestCase):
    def test_llm_retries_transient_http_errors_with_exponential_backoff(self):
        class ProviderError(RuntimeError):
            def __init__(self, status_code):
                super().__init__(f"HTTP {status_code}")
                self.status_code = status_code

        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok": true}'))]
        )
        client = MagicMock()
        for status_code in (429, 500, 503):
            with self.subTest(status_code=status_code):
                client.reset_mock()
                client.chat.completions.create.side_effect = [
                    ProviderError(status_code),
                    response,
                ]
                with patch.object(llm_client, "_use_agentrouter", return_value=False), patch.object(
                    llm_client, "_get_groq_client", return_value=client
                ), patch.object(llm_client, "MAX_RETRIES", 3), patch.object(
                    llm_client, "BACKOFF_BASE_SECONDS", 1
                ), patch.object(llm_client.time, "sleep") as sleep:
                    result = llm_client.chat_json("system", "user")

                self.assertEqual(result, {"ok": True})
                self.assertEqual(client.chat.completions.create.call_count, 2)
                sleep.assert_called_once_with(1)

    def test_llm_backoff_doubles_between_attempts(self):
        class ProviderError(RuntimeError):
            status_code = 503

        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok": true}'))]
        )
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            ProviderError("unavailable"),
            ProviderError("unavailable"),
            response,
        ]

        with patch.object(llm_client, "_use_agentrouter", return_value=False), patch.object(
            llm_client, "_get_groq_client", return_value=client
        ), patch.object(llm_client, "MAX_RETRIES", 3), patch.object(
            llm_client, "BACKOFF_BASE_SECONDS", 1
        ), patch.object(llm_client.time, "sleep") as sleep:
            llm_client.chat_json("system", "user")

        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_llm_does_not_retry_non_transient_errors(self):
        class ProviderError(RuntimeError):
            status_code = 400

        client = MagicMock()
        client.chat.completions.create.side_effect = ProviderError("bad request")

        with patch.object(llm_client, "_use_agentrouter", return_value=False), patch.object(
            llm_client, "_get_groq_client", return_value=client
        ), patch.object(llm_client.time, "sleep") as sleep:
            with self.assertRaises(ProviderError):
                llm_client.chat_json("system", "user")

        client.chat.completions.create.assert_called_once()
        sleep.assert_not_called()

    def test_cron_partial_entity_failure_returns_summary_without_raising(self):
        entities_query = MagicMock()
        entities_query.select.return_value.execute.return_value.data = [
            {"id": "entity-a", "name": "Healthy Brand", "social_handle": None},
            {"id": "entity-b", "name": "Provider Failure", "social_handle": None},
        ]
        active_query = MagicMock()
        active_query.select.return_value.eq.return_value.gt.return_value.execute.return_value.data = []
        admin = MagicMock()
        admin.table.side_effect = [entities_query, active_query]
        recovery = MagicMock(status_code=200)
        recovery.json.return_value = {"entity_ids": []}
        stage_results = [
            {"pipeline_run_id": "run-a", "worker_token": "token-a"}, {}, {}, {},
            {"pipeline_run_id": "run-b", "worker_token": "token-b"}, False,
        ]

        with patch.object(cron_sync, "INTERNAL_API_KEY", "test-key"), patch.object(
            cron_sync, "require_supabase_admin", return_value=admin
        ), patch.object(cron_sync, "wait_for_backend", return_value=True), patch.object(
            cron_sync.requests, "post", return_value=recovery
        ), patch.object(cron_sync, "_post_stage", side_effect=stage_results), patch.object(
            cron_sync.logger, "error"
        ) as log_error:
            summary = cron_sync.run_automated_pipeline()

        self.assertEqual(summary.total, 2)
        self.assertEqual(summary.succeeded, 1)
        self.assertEqual(summary.failed, 1)
        self.assertEqual(summary.failed_entities, [
            {"id": "entity-b", "name": "Provider Failure", "stage": "analysis"}
        ])
        log_error.assert_called_once()

    def test_every_weighted_category_is_reachable_from_sentiment_prompt(self):
        match = re.search(r'"category": "([^"]+)"', sentiment.SYSTEM_PROMPT)
        self.assertIsNotNone(match, "SYSTEM_PROMPT must declare its category enum")
        prompt_categories = set(match.group(1).split("|"))

        self.assertEqual(prompt_categories, constants.VALID_CATEGORIES)
        self.assertEqual(prompt_categories, set(constants.CATEGORY_WEIGHTS))

    def test_authorization_header_requires_bearer_scheme(self):
        with self.assertRaises(api_main.HTTPException) as context:
            api_main.verify_user("Basic token")
        self.assertEqual(context.exception.status_code, 401)

    def test_manual_analysis_schedules_owned_entity_once(self):
        background_tasks = MagicMock()
        entity = {
            "id": "entity-a",
            "name": "Example",
            "profile_type": "business",
            "social_handle": "@example",
            "user_id": "user-a",
        }

        with patch.object(api_main, "_require_owned_entity", return_value=entity) as require_owned, patch.object(
            api_main, "_get_active_pipeline_run", return_value=None
        ), patch.object(api_main, "_record_pipeline_run", return_value="run-a"):
            result = api_main.trigger_owned_entity_analysis(
                "entity-a",
                background_tasks,
                user=SimpleNamespace(id="user-a"),
            )

        self.assertTrue(result["scheduled"])
        self.assertEqual(result["pipeline_run"]["id"], "run-a")
        require_owned.assert_called_once_with("entity-a", "user-a")
        background_tasks.add_task.assert_called_once()
        task_args = background_tasks.add_task.call_args.args
        self.assertIs(task_args[0], api_main.run_analysis_pipeline)
        self.assertEqual(task_args[1:5], ("entity-a", "Example", "business", "@example"))
        self.assertEqual(task_args[5], "run-a")

    def test_manual_analysis_does_not_duplicate_active_run(self):
        background_tasks = MagicMock()
        active_run = {
            "id": "run-active",
            "status": "running",
            "stage": "analyzing_sentiment",
            "lease_expires_at": "2026-08-04T12:00:00+00:00",
        }

        with patch.object(
            api_main,
            "_require_owned_entity",
            return_value={
                "id": "entity-a",
                "name": "Example",
                "profile_type": "business",
                "user_id": "user-a",
            },
        ), patch.object(api_main, "_get_active_pipeline_run", return_value=active_run), patch.object(
            api_main, "_record_pipeline_run"
        ) as record_run:
            result = api_main.trigger_owned_entity_analysis(
                "entity-a",
                background_tasks,
                user=SimpleNamespace(id="user-a"),
            )

        self.assertFalse(result["scheduled"])
        self.assertEqual(result["status"], "already_running")
        self.assertEqual(result["pipeline_run"], active_run)
        record_run.assert_not_called()
        background_tasks.add_task.assert_not_called()

    def test_manual_analysis_requires_entity_ownership(self):
        background_tasks = MagicMock()

        with patch.object(
            api_main,
            "_require_owned_entity",
            side_effect=api_main.HTTPException(status_code=404, detail="Entity not found"),
        ), patch.object(api_main, "_get_active_pipeline_run") as active_lookup:
            with self.assertRaises(api_main.HTTPException) as context:
                api_main.trigger_owned_entity_analysis(
                    "entity-a",
                    background_tasks,
                    user=SimpleNamespace(id="user-b"),
                )

        self.assertEqual(context.exception.status_code, 404)
        active_lookup.assert_not_called()
        background_tasks.add_task.assert_not_called()

    def test_entity_payload_rejects_more_than_three_competitors(self):
        with self.assertRaises(Exception):
            api_main.BrandCreateRequest(
                name="Example",
                competitors=["A", "B", "C", "D"],
            )

    def test_competitive_intelligence_rejects_unsupported_window(self):
        with patch.object(api_main, "_require_owned_entity") as require_owned:
            with self.assertRaises(api_main.HTTPException) as context:
                api_main.get_competitive_intelligence(
                    "entity-a", window=14, user=SimpleNamespace(id="user-a")
                )

        self.assertEqual(context.exception.status_code, 400)
        require_owned.assert_not_called()

    def test_competitive_intelligence_reports_shares_trends_and_partial_evidence(self):
        period_start = datetime(2026, 7, 5, tzinfo=timezone.utc)
        period_end = datetime(2026, 8, 4, tzinfo=timezone.utc)
        result = api_main._build_competitive_intelligence(
            primary_entity_id="entity-a",
            entities=[
                {"id": "entity-a", "name": "Primary"},
                {"id": "entity-b", "name": "Competitor"},
            ],
            mentions=[
                {
                    "id": "mention-a1", "entity_id": "entity-a", "source": "Reddit",
                    "status": "processed", "created_at": "2026-08-01T10:00:00Z",
                },
                {
                    "id": "mention-a2", "entity_id": "entity-a", "source": "Reddit",
                    "status": "pending", "created_at": "2026-08-02T10:00:00Z",
                },
                {
                    "id": "mention-b1", "entity_id": "entity-b", "platform": "twitter",
                    "status": "processed", "created_at": "2026-08-03T10:00:00Z",
                },
                {
                    "id": "mention-rejected", "entity_id": "entity-b", "source": "Spam",
                    "status": "rejected", "created_at": "2026-08-03T11:00:00Z",
                },
            ],
            sentiments=[
                {"mention_id": "mention-a1", "label": "negative", "category": "service"},
                {"mention_id": "mention-b1", "label": "positive", "category": "praise"},
            ],
            risk_snapshots=[
                {"entity_id": "entity-a", "score": 40, "status": "watch", "created_at": "2026-07-10T00:00:00Z"},
                {"entity_id": "entity-a", "score": 55, "status": "elevated", "created_at": "2026-08-03T00:00:00Z"},
            ],
            window_days=30,
            period_start=period_start,
            period_end=period_end,
        )

        primary, competitor = result["entities"]
        self.assertEqual(primary["shares"]["voice"], 66.7)
        self.assertEqual(primary["shares"]["negative"], 100.0)
        self.assertEqual(primary["evidence_status"], "partial")
        self.assertEqual(primary["coverage_pct"], 50.0)
        self.assertEqual(primary["risk_delta"], 15)
        self.assertEqual(primary["latest_risk"]["score"], 55)
        self.assertEqual(primary["top_categories"][0]["filters"]["category"], "service")
        self.assertEqual(primary["trend"][-1]["risk_score"], 55)
        self.assertEqual(competitor["shares"]["voice"], 33.3)
        self.assertEqual(competitor["counts"]["mentions"], 1)
        self.assertEqual(result["total_mentions"], 3)

    def test_competitive_intelligence_requires_primary_ownership(self):
        with patch.object(
            api_main,
            "_require_owned_entity",
            side_effect=api_main.HTTPException(status_code=404, detail="Entity not found"),
        ), patch.object(api_main, "supabase_admin", MagicMock()) as admin:
            with self.assertRaises(api_main.HTTPException) as context:
                api_main.get_competitive_intelligence(
                    "entity-a", window=30, user=SimpleNamespace(id="user-b")
                )

        self.assertEqual(context.exception.status_code, 404)
        admin.table.assert_not_called()

    def test_mention_deduplication_is_scoped_to_entity(self):
        lookup = QueryDouble(data=[])
        insert = QueryDouble(data=[])
        admin = MagicMock()
        admin.table.side_effect = [lookup, insert]

        with patch.object(scrapers, "supabase_admin", admin):
            created = scrapers._insert_mention(
                "entity-a", "Reddit", "A meaningful mention", "https://example.com/post"
            )

        self.assertTrue(created)
        self.assertIn(("entity_id", "entity-a"), lookup.filters)
        self.assertIn(("url", "https://example.com/post"), lookup.filters)
        self.assertEqual(insert.inserted["entity_id"], "entity-a")

    def test_social_mention_preserves_stable_source_metadata(self):
        lookup = QueryDouble(data=[])
        insert = QueryDouble(data=[])
        admin = MagicMock()
        admin.table.side_effect = [lookup, insert]

        with patch.object(scrapers, "supabase_admin", admin):
            created = scrapers._insert_mention(
                "entity-a",
                "YouTube",
                "A customer comment",
                "https://youtube.example/watch?v=video-1&lc=comment-1",
                platform="youtube",
                source_post_id="video-1",
                source_comment_id="comment-1",
                author_name="Customer",
                engagement={"likes": 4},
                published_at="2026-07-31T10:00:00Z",
            )

        self.assertTrue(created)
        self.assertIn(("platform", "youtube"), lookup.filters)
        self.assertIn(("source_comment_id", "comment-1"), lookup.filters)
        self.assertEqual(insert.inserted["source_post_id"], "video-1")
        self.assertEqual(insert.inserted["author_name"], "Customer")
        self.assertEqual(insert.inserted["engagement"], {"likes": 4})
        self.assertEqual(insert.inserted["published_at"], "2026-07-31T10:00:00+00:00")

    def test_hard_negative_signal_cannot_be_neutral(self):
        result = sentiment.validate_ai_output(
            {
                "sentiment": "neutral",
                "category": "general",
                "sub_category": "general",
                "severity": 2,
                "confidence": 0.9,
                "risk": "low",
                "root_cause": "Unclear report",
                "reason": "Insufficient context",
            },
            "Customers paid for land but received no refund three years later.",
        )

        self.assertEqual(result["sentiment"], "negative")
        self.assertGreaterEqual(result["severity"], 8)
        self.assertIn(result["risk"], {"high", "critical"})

    def test_legacy_llm_fields_do_not_default_to_neutral(self):
        result = sentiment.validate_ai_output({
            "sentiment_label": "negative",
            "category": "customer_complaint",
            "severity_score": 7,
            "confidence": 0.91,
            "risk_level": "high",
            "recommendation": "Investigate repeated transfer failures.",
        })

        self.assertEqual(result["sentiment"], "negative")
        self.assertEqual(result["severity"], 7)
        self.assertEqual(result["risk"], "high")
        self.assertEqual(result["reason"], "Investigate repeated transfer failures.")

    def test_source_names_are_normalized_to_scoring_keys(self):
        self.assertEqual(risk_engine._normalise_source("Twitter/X"), "twitter")
        self.assertEqual(risk_engine._normalise_source("Reddit"), "reddit")
        self.assertEqual(risk_engine._normalise_source("tavily_live_search"), "nigerian_news")

    def test_risk_fetch_uses_bounded_recent_window(self):
        mentions = QueryDouble(data=[])
        admin = MagicMock()
        admin.table.return_value = mentions

        with patch.object(risk_engine, "supabase_admin", admin):
            rows = risk_engine.fetch_mentions("entity-a")

        self.assertEqual(rows, [])
        self.assertIn(("entity_id", "entity-a"), mentions.filters)
        self.assertTrue(any(key == "created_at__gte" for key, _value in mentions.filters))

    def test_unprocessed_lookup_scopes_processed_ids_to_candidates(self):
        candidates = QueryDouble(data=[{"id": "mention-a", "status": None}])
        processed = QueryDouble(data=[])
        admin = MagicMock()
        admin.table.side_effect = [candidates, processed]

        with patch.object(sentiment, "supabase_admin", admin):
            rows = sentiment.get_unprocessed_mentions("entity-a", limit=20)

        self.assertEqual([row["id"] for row in rows], ["mention-a"])
        self.assertIn(("entity_id", "entity-a"), candidates.filters)
        self.assertIn(("mention_id__in", ["mention-a"]), processed.filters)

    def test_relevance_failure_routes_mention_to_review(self):
        with patch.object(
            sentiment.llm_client,
            "chat_json",
            side_effect=RuntimeError("provider unavailable"),
        ):
            decision = sentiment._llm_relevance_check(
                "Example is mentioned in this sufficiently long report.",
                "Example",
            )

        self.assertEqual(decision, sentiment.RELEVANCE_NEEDS_REVIEW)

    def test_relevance_failure_marks_review_without_failing_batch(self):
        with patch.object(sentiment.llm_client, "_use_agentrouter", return_value=True), patch.object(
            sentiment, "_fetch_entity_context", return_value=("business", [])
        ), patch.object(
            sentiment,
            "get_unprocessed_mentions",
            return_value=[{"id": "mention-review", "content": "Example appears in a substantive report."}],
        ), patch.object(
            sentiment, "is_relevant", return_value=sentiment.RELEVANCE_NEEDS_REVIEW
        ), patch.object(sentiment, "_set_mention_status") as set_status, patch.object(
            sentiment, "call_groq"
        ) as analyze:
            result = sentiment.analyze_and_store_sentiment(
                entity_id="entity-a", brand_name="Example", limit=1
            )

        self.assertEqual(result, {"processed": 0, "failed": 0, "needs_review": 1})
        set_status.assert_called_once_with("mention-review", "needs_review")
        analyze.assert_not_called()

    def test_needs_review_mentions_are_not_automatically_reprocessed(self):
        candidates = QueryDouble(data=[
            {"id": "mention-review", "status": "needs_review"},
            {"id": "mention-pending", "status": "pending"},
        ])
        processed = QueryDouble(data=[])
        admin = MagicMock()
        admin.table.side_effect = [candidates, processed]

        with patch.object(sentiment, "supabase_admin", admin):
            rows = sentiment.get_unprocessed_mentions("entity-a", limit=20)

        self.assertEqual([row["id"] for row in rows], ["mention-pending"])

    def test_sentiment_pipeline_uses_configured_batch_limit(self):
        with patch.object(sentiment, "GROQ_API_KEY", "test-groq-key"), patch.object(
            sentiment, "_fetch_entity_context", return_value=("business", [])
        ), patch.object(sentiment, "get_unprocessed_mentions", return_value=[]) as get_mentions:
            result = sentiment.analyze_and_store_sentiment(
                entity_id="entity-a",
                brand_name="Example",
                limit=2,
            )

        self.assertEqual(result, {"processed": 0, "failed": 0})
        get_mentions.assert_called_once_with(entity_id="entity-a", limit=2)

    def test_positive_mentions_reduce_aggregate_risk(self):
        now = datetime.now(timezone.utc).isoformat()
        negative = {
            "label": "negative",
            "severity": 5,
            "confidence": 1,
            "source": "reddit",
            "category": "general",
            "risk_level": "low",
            "created_at": now,
        }
        positive = {
            **negative,
            "label": "positive",
            "category": "customer_praise",
        }

        negative_only = scoring.calculate_entity_score([negative])["score"]
        balanced = scoring.calculate_entity_score([negative, positive])["score"]
        self.assertLess(balanced, negative_only)

    def test_negative_volume_increases_risk(self):
        negative = {
            "label": "negative", "severity": 5, "confidence": 1,
            "source": "reddit", "category": "general", "risk_level": "medium",
        }

        one_negative = scoring.calculate_entity_score([negative])["score"]
        five_negatives = scoring.calculate_entity_score([negative] * 5)["score"]

        self.assertGreater(five_negatives, one_negative)

    def test_positive_only_volume_does_not_create_risk(self):
        positive = {
            "label": "positive", "severity": 5, "confidence": 1,
            "source": "reddit", "category": "customer_praise", "risk_level": "low",
        }

        self.assertEqual(scoring.calculate_entity_score([positive] * 50)["score"], 0)

    def test_negative_volume_multiplier_does_not_amplify_positive_offsets(self):
        positive = {
            "label": "positive", "severity": 5, "confidence": 1,
            "source": "reddit", "category": "customer_praise", "risk_level": "low",
        }
        negative = {
            "label": "negative", "severity": 2, "confidence": 1,
            "source": "reddit", "category": "general", "risk_level": "low",
        }
        stronger_negative = {
            **negative,
            "severity": 1,
            "confidence": 0.7,
            "source": "other",
        }
        moderate_positive = {
            **positive,
            "severity": 3,
            "confidence": 0.8,
            "source": "other",
        }

        positive_heavy = scoring.calculate_entity_score([positive] * 50 + [negative])["score"]
        mixed = scoring.calculate_entity_score([moderate_positive] * 2 + [stronger_negative] * 5)["score"]
        negative_heavy = scoring.calculate_entity_score([stronger_negative] * 5)["score"]

        self.assertEqual(positive_heavy, 0)
        self.assertGreater(mixed, positive_heavy)
        self.assertGreater(negative_heavy, mixed)

    def test_volume_multiplier_scales_only_negative_contributions(self):
        mentions = [
            {"label": "negative", "category": "general"},
            {"label": "negative", "category": "general"},
            {"label": "negative", "category": "general"},
            {"label": "positive", "category": "customer_praise"},
        ]

        def fixed_contribution(**kwargs):
            return 10 if kwargs["sentiment"] == "negative" else -10

        with patch.object(scoring, "mention_score", side_effect=fixed_contribution):
            score = scoring.calculate_entity_score(mentions)["score"]

        # Correct: (3 * 10 * 1.15) + -10 = 24.5 -> round(24.5) == 24.
        # Old scope: ((3 * 10) + -10) * 1.15 = 23.
        self.assertEqual(score, 24)

    def test_email_alert_is_not_repeated_above_threshold(self):
        with patch.object(risk_engine.resend.Emails, "send") as send:
            sent = risk_engine.send_email(
                {"id": "entity-a", "name": "Example", "profile_type": "business"},
                {
                    "score": 80,
                    "status": "critical",
                    "negative_mentions": 3,
                    "positive_mentions": 0,
                    "neutral_mentions": 0,
                },
                previous_score=70,
            )

        self.assertFalse(sent)
        send.assert_not_called()

    def test_email_delivery_failure_does_not_raise(self):
        with patch.dict(os.environ, {"ALERT_EMAIL_FALLBACK": "alerts@example.com"}), patch.object(
            risk_engine.resend.Emails,
            "send",
            side_effect=RuntimeError("provider unavailable"),
        ):
            sent = risk_engine.send_email(
                {"id": "entity-a", "name": "Example", "profile_type": "business"},
                {
                    "score": 80,
                    "status": "critical",
                    "negative_mentions": 3,
                    "positive_mentions": 0,
                    "neutral_mentions": 0,
                },
                previous_score=40,
            )

        self.assertFalse(sent)

    def test_alert_event_allows_status_escalation(self):
        self.assertTrue(risk_engine.is_alert_event(
            {"score": 82, "status": "critical"}, previous_score=68, previous_status="high"
        ))
        self.assertFalse(risk_engine.is_alert_event(
            {"score": 75, "status": "high"}, previous_score=68, previous_status="high"
        ))

    def test_high_risk_event_creates_pending_crisis_brief(self):
        query = MagicMock()
        query.upsert.return_value.execute.return_value.data = [{"id": "brief-a"}]
        admin = MagicMock()
        admin.table.return_value = query
        score = {
            "score": 68,
            "status": "high",
            "negative_mentions": 3,
            "positive_mentions": 1,
            "neutral_mentions": 2,
            "root_cause_summary": "Top drivers: Operations outage",
        }

        with patch.object(risk_engine, "supabase_admin", admin):
            created = risk_engine.create_pending_crisis_brief(
                {"id": "entity-a", "name": "Example"},
                score,
                "snapshot-a",
                previous_score=45,
                previous_status="elevated",
            )

        self.assertTrue(created)
        payload = query.upsert.call_args.args[0]
        self.assertEqual(payload["status"], "pending")
        self.assertEqual(payload["severity"], "high")
        self.assertEqual(payload["risk_snapshot_id"], "snapshot-a")
        self.assertEqual(payload["event_key"], "risk:entity-a:snapshot-a")
        query.upsert.assert_called_once_with(
            payload, on_conflict="event_key", ignore_duplicates=True
        )

    def test_lower_risk_event_does_not_create_crisis_brief(self):
        admin = MagicMock()
        with patch.object(risk_engine, "supabase_admin", admin):
            created = risk_engine.create_pending_crisis_brief(
                {"id": "entity-a", "name": "Example"},
                {"score": 55, "status": "elevated"},
                "snapshot-a",
                previous_score=35,
                previous_status="watch",
            )

        self.assertFalse(created)
        admin.table.assert_not_called()

    def test_duplicate_crisis_event_key_is_skipped_safely(self):
        query = MagicMock()
        query.upsert.return_value.execute.return_value.data = []
        admin = MagicMock()
        admin.table.return_value = query

        with patch.object(risk_engine, "supabase_admin", admin):
            created = risk_engine.create_pending_crisis_brief(
                {"id": "entity-a", "name": "Example"},
                {"score": 82, "status": "critical"},
                "snapshot-a",
                previous_score=68,
                previous_status="high",
            )

        self.assertFalse(created)
        self.assertEqual(
            query.upsert.call_args.args[0]["event_key"],
            "risk:entity-a:snapshot-a",
        )

    def test_crisis_brief_failure_status_can_be_persisted(self):
        query = MagicMock()
        query.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "brief-a", "status": "failed"}
        ]
        admin = MagicMock()
        admin.table.return_value = query

        with patch.object(risk_engine, "supabase_admin", admin):
            updated = risk_engine.mark_crisis_brief_failed(
                "brief-a",
                "provider unavailable",
                {"provider": "future-agent"},
            )

        self.assertTrue(updated)
        payload = query.update.call_args.args[0]
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error_message"], "provider unavailable")
        self.assertEqual(payload["error_details"], {"provider": "future-agent"})

    def test_crisis_brief_persistence_failure_does_not_change_risk_behavior(self):
        admin = MagicMock()
        admin.table.return_value.upsert.side_effect = RuntimeError("table unavailable")
        score = {"score": 82, "status": "critical"}

        with patch.object(risk_engine, "supabase_admin", admin):
            created = risk_engine.create_pending_crisis_brief(
                {"id": "entity-a", "name": "Example"},
                score,
                "snapshot-a",
                previous_score=68,
                previous_status="high",
            )

        self.assertFalse(created)
        self.assertTrue(risk_engine.is_alert_event(
            score, previous_score=68, previous_status="high"
        ))

    def test_crisis_brief_migration_enforces_snapshot_entity_match(self):
        migration = (
            BACKEND_DIR.parent / "scripts" / "2026-08-28_crisis_briefs.sql"
        ).read_text()
        normalized = " ".join(migration.split()).lower()

        self.assertIn(
            "create unique index if not exists risk_scores_id_entity_unique_idx "
            "on public.risk_scores (id, entity_id)",
            normalized,
        )
        self.assertIn(
            "foreign key (risk_snapshot_id, entity_id) references "
            "public.risk_scores (id, entity_id) on delete cascade",
            normalized,
        )


if __name__ == "__main__":
    unittest.main()
