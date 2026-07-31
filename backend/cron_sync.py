# backend/cron_sync.py
import time
import requests
from database import require_supabase_admin
import os
import sys
import logging
from dataclasses import dataclass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
SYNC_TIMEOUT = int(os.getenv("PIPELINE_SYNC_TIMEOUT", "300"))
ANALYZE_TIMEOUT = int(os.getenv("PIPELINE_ANALYZE_TIMEOUT", "180"))
RISK_TIMEOUT = int(os.getenv("PIPELINE_RISK_TIMEOUT", "60"))

# Sent on every internal POST so the backend's verify_internal_key dependency
# accepts these machine-to-machine calls.
INTERNAL_HEADERS = {"X-Internal-Key": INTERNAL_API_KEY}


@dataclass
class PipelineSummary:
    total: int = 0
    succeeded: int = 0
    failed: int = 0


class PipelineRunError(RuntimeError):
    pass


def wait_for_backend(max_attempts: int = 10, delay: int = 8):
    """
    Free-tier hosts (e.g. Render) spin the web service down after idle and take
    ~30-50s to wake. Ping the public health endpoint until it responds so the
    pipeline's real calls don't hit a cold, unresponsive service.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            r = requests.get(f"{BACKEND_URL}/", timeout=15)
            if r.status_code == 200:
                logging.info(f"🌡️ Backend awake after {attempt} attempt(s).")
                return True
        except Exception as e:
            logging.info(f"⏳ Backend not ready (attempt {attempt}/{max_attempts}): {e}")
        time.sleep(delay)

    logging.error("Backend did not respond to warmup.")
    return False


def _post_stage(path: str, entity: dict, timeout: int) -> bool:
    """Call one internal stage and return whether it completed successfully."""
    name = entity["name"]
    try:
        response = requests.post(
            f"{BACKEND_URL}{path}",
            params={
                "brand_name": name,
                **({"social_handle": entity.get("social_handle")} if entity.get("social_handle") else {}),
            } if path.startswith("/sync/") else (
                {"entity_id": entity["id"], "brand_name": name}
                if path == "/analyze" else None
            ),
            headers=INTERNAL_HEADERS,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        logging.error("Request failed for %s at %s: %s", name, path, exc)
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
    return True


def run_automated_pipeline():
    """
    Runs the full reputation pipeline once:
    1. Fetch all monitored brands
    2. Scrape mentions (sync)
    3. Analyze sentiment (AI)
    4. Calculate risk scores
    """
    logging.info(f"⏰ Background sync started at {time.strftime('%Y-%m-%d %H:%M:%S')}")

    if not INTERNAL_API_KEY:
        raise PipelineRunError("INTERNAL_API_KEY is required for scheduled pipeline calls")

    # Resolve this before warmup so a missing service-role secret fails fast.
    admin = require_supabase_admin()

    if not wait_for_backend():
        raise PipelineRunError("Backend is unavailable after warmup attempts")

    try:
        # 1. Fetch every monitored brand from the database
        entities_res = admin.table("monitored_entities").select("id, name, social_handle").execute()
        entities = entities_res.data or []

        if not entities:
            logging.info("No monitored entities found. Exiting.")
            return PipelineSummary()

        logging.info(f"Found {len(entities)} entities to process.")
        summary = PipelineSummary(total=len(entities))

        # Process each entity in order. A failed scrape must not race ahead into
        # analysis while an external actor may still be running.
        for entity in entities:
            entity_id = entity["id"]
            name = entity["name"]
            logging.info("Syncing sources for %s", name)

            stages = (
                (f"/sync/{entity_id}", SYNC_TIMEOUT, "sync"),
                ("/analyze", ANALYZE_TIMEOUT, "analysis"),
                (f"/calculate-risk/{entity_id}", RISK_TIMEOUT, "risk calculation"),
            )
            for path, timeout, label in stages:
                if not _post_stage(path, entity, timeout):
                    logging.error("Stopping %s pipeline after failed %s", name, label)
                    summary.failed += 1
                    break
                logging.info("Completed %s for %s", label, name)
            else:
                summary.succeeded += 1

        logging.info(
            "System sync cycle complete: %s succeeded, %s failed, %s total",
            summary.succeeded,
            summary.failed,
            summary.total,
        )
        if summary.failed:
            raise PipelineRunError(
                f"Pipeline failed for {summary.failed} of {summary.total} entities"
            )
        return summary

    except Exception as e:
        logging.exception("Pipeline failed: %s", e)
        raise

if __name__ == "__main__":
    try:
        run_automated_pipeline()
    except Exception:
        sys.exit(1)
    sys.exit(0)
