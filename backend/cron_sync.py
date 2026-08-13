# backend/cron_sync.py

import logging
import os
import sys
import time
from dataclasses import dataclass, field

import requests

from database import require_supabase_admin


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")

SYNC_TIMEOUT = int(os.getenv("PIPELINE_SYNC_TIMEOUT", "300"))
ANALYZE_TIMEOUT = int(os.getenv("PIPELINE_ANALYZE_TIMEOUT", "180"))
ANALYZE_BATCH_LIMIT = max(
    1,
    min(20, int(os.getenv("PIPELINE_ANALYZE_BATCH_LIMIT", "2"))),
)
RISK_TIMEOUT = int(os.getenv("PIPELINE_RISK_TIMEOUT", "60"))

# Sent on every internal POST so the backend's verify_internal_key
# dependency accepts these machine-to-machine calls.
INTERNAL_HEADERS = {
    "X-Internal-Key": INTERNAL_API_KEY,
}


@dataclass
class PipelineSummary:
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    failed_entities: list[dict] = field(default_factory=list)


class PipelineRunError(RuntimeError):
    pass


def wait_for_backend(max_attempts: int = 10, delay: int = 8):
    """
    Free-tier hosts (e.g. Render) may spin the web service down after idle
    and take ~30-50 seconds to wake.

    Ping the health endpoint until it responds so the pipeline's real calls
    don't hit a cold or unresponsive service.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.get(
                f"{BACKEND_URL}/health/ready",
                timeout=15,
            )

            if response.status_code == 200:
                logging.info(
                    "🌡️ Backend awake after %s attempt(s).",
                    attempt,
                )
                return True

        except Exception as exc:
            logging.info(
                "⏳ Backend not ready (attempt %s/%s): %s",
                attempt,
                max_attempts,
                exc,
            )

        time.sleep(delay)

    logging.error("Backend did not respond to warmup.")
    return False


def _post_stage(
    path: str,
    entity: dict,
    timeout: int,
    pipeline: dict | None = None,
):
    """Call one internal pipeline stage and return its JSON payload on success."""
    name = entity["name"]

    try:
        if path.startswith("/sync/"):
            params = {
                "brand_name": name,
            }

            if entity.get("social_handle"):
                params["social_handle"] = entity["social_handle"]

            if pipeline:
                params["pipeline_run_id"] = pipeline["id"]
                params["worker_token"] = pipeline["worker_token"]

        elif path == "/analyze":
            params = {
                "entity_id": entity["id"],
                "brand_name": name,
                "limit": ANALYZE_BATCH_LIMIT,
            }

            if pipeline:
                params["pipeline_run_id"] = pipeline["id"]
                params["worker_token"] = pipeline["worker_token"]

        elif path.startswith("/calculate-risk/"):
            params = None

            if pipeline:
                params = {
                    "pipeline_run_id": pipeline["id"],
                    "worker_token": pipeline["worker_token"],
                }

        else:
            params = None

        response = requests.post(
            f"{BACKEND_URL}{path}",
            params=params,
            headers=INTERNAL_HEADERS,
            timeout=timeout,
        )

    except requests.RequestException as exc:
        logging.error(
            "Request failed for %s at %s: %s",
            name,
            path,
            exc,
        )
        return False

    if response.status_code != 200:
        logging.error(
            "Stage %s returned %s for %s: %s",
            path,
            response.status_code,
            name,
            response.text[:300],
        )
        return False

    try:
        return response.json()
    except ValueError:
        return {}


def run_automated_pipeline():
    """
    Runs the full reputation pipeline once:

    1. Fetch all monitored brands
    2. Scrape mentions (sync)
    3. Analyze sentiment (AI)
    4. Calculate risk scores
    """
    logging.info(
        "⏰ Background sync started at %s",
        time.strftime("%Y-%m-%d %H:%M:%S"),
    )

    if not INTERNAL_API_KEY:
        raise PipelineRunError(
            "INTERNAL_API_KEY is required for scheduled pipeline calls"
        )

    # Resolve this before warmup so a missing service-role secret fails fast.
    admin = require_supabase_admin()

    if not wait_for_backend():
        raise PipelineRunError(
            "Backend is unavailable after warmup attempts"
        )

    try:
        recovered_entity_ids = set()

        recovery_response = requests.post(
            f"{BACKEND_URL}/internal/recover-pipelines",
            params={"limit": 25},
            headers=INTERNAL_HEADERS,
            timeout=30,
        )

        if recovery_response.status_code != 200:
            logging.warning(
                "Pipeline recovery returned %s: %s",
                recovery_response.status_code,
                recovery_response.text[:300],
            )
        else:
            recovery_payload = recovery_response.json()
            recovered_entity_ids = set(
                recovery_payload.get("entity_ids") or []
            )

            logging.info(
                "Pipeline recovery: %s",
                recovery_payload,
            )

        # 1. Fetch every monitored brand from the database.
        entities_res = (
            admin.table("monitored_entities")
            .select("id, name, social_handle")
            .execute()
        )

        entities = [
            entity
            for entity in (entities_res.data or [])
            if entity["id"] not in recovered_entity_ids
        ]

        # Do not launch a second run for an entity whose leased pipeline
        # is still active.
        try:
            active_runs = (
                admin.table("pipeline_runs")
                .select("entity_id")
                .eq("status", "running")
                .gt(
                    "lease_expires_at",
                    time.strftime(
                        "%Y-%m-%dT%H:%M:%SZ",
                        time.gmtime(),
                    ),
                )
                .execute()
            ).data or []

            active_ids = {
                run["entity_id"]
                for run in active_runs
            }

            entities = [
                entity
                for entity in entities
                if entity["id"] not in active_ids
            ]

        except Exception as exc:
            # Older deployments may not have pipeline_runs yet.
            # Stage endpoints remain usable while the migration is rolled out.
            logging.warning(
                "Could not inspect active pipeline leases: %s",
                exc,
            )

        if not entities:
            logging.info("No monitored entities found. Exiting.")
            return PipelineSummary()

        logging.info(
            "Found %s entities to process.",
            len(entities),
        )

        summary = PipelineSummary(
            total=len(entities),
        )

        # Process each entity in order.
        # A failed scrape must not race ahead into analysis while an
        # external actor may still be running.
        for entity in entities:
            entity_id = entity["id"]
            name = entity["name"]

            logging.info(
                "Syncing sources for %s",
                name,
            )

            stages = (
                (
                    f"/sync/{entity_id}",
                    SYNC_TIMEOUT,
                    "sync",
                ),
                (
                    "/analyze",
                    ANALYZE_TIMEOUT,
                    "analysis",
                ),
                (
                    f"/calculate-risk/{entity_id}",
                    RISK_TIMEOUT,
                    "risk calculation",
                ),
            )

            pipeline = None

            for path, timeout, label in stages:
                result = _post_stage(
                    path,
                    entity,
                    timeout,
                    pipeline,
                )

                if result is False:
                    logging.error(
                        "Stopping %s pipeline after failed %s",
                        name,
                        label,
                    )

                    summary.failed += 1
                    summary.failed_entities.append({
                        "id": entity_id,
                        "name": name,
                        "stage": label,
                    })
                    break

                if (
                    path.startswith("/sync/")
                    and result.get("pipeline_run_id")
                ):
                    pipeline = {
                        "id": result["pipeline_run_id"],
                        "worker_token": result.get("worker_token"),
                    }

                logging.info(
                    "Completed %s for %s",
                    label,
                    name,
                )

            else:
                summary.succeeded += 1

        logging.info(
            "System sync cycle complete: %s succeeded, %s failed, %s total",
            summary.succeeded,
            summary.failed,
            summary.total,
        )
        if summary.failed:
            logger.error(
                "Partial pipeline failure: %s of %s entities failed; successful entities were preserved. Failed entities: %s",
                summary.failed,
                summary.total,
                summary.failed_entities,
            )
        return summary

    except Exception as exc:
        logging.exception(
            "Pipeline failed: %s",
            exc,
        )
        raise


if __name__ == "__main__":
    try:
        run_automated_pipeline()
    except Exception:
        sys.exit(1)

    sys.exit(0)
