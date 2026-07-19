"""
Thin Apify adapter (disabled until APIFY_TOKEN is set).

Apify hosts pre-built scrapers ("actors") for platforms that have no free read
API — notably X/Twitter and Facebook. We run an actor synchronously and read
back its dataset items.

Everything here is a safe no-op when APIFY_TOKEN is unset, so the pipeline can
ship today and be enabled later purely via env vars in Render.

NOTE (for the operator): scraping X/Facebook via third-party actors is against
those platforms' ToS. Fine for MVP/demo testing on a free tier; understand the
risk before relying on it in production.
"""

import os
import logging
from typing import Any, Dict, List

import requests

APIFY_TOKEN = os.getenv("APIFY_TOKEN")
APIFY_BASE_URL = "https://api.apify.com/v2"

# How long to wait for a synchronous actor run before giving up (seconds).
RUN_TIMEOUT = 120


def is_enabled() -> bool:
    return bool(APIFY_TOKEN)


def run_actor(actor_id: str, run_input: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Runs an Apify actor synchronously and returns its dataset items.

    Returns [] on any failure or when Apify is not configured — callers treat
    an empty list as "nothing scraped" and continue.
    """
    if not is_enabled():
        logging.info("Apify not configured (APIFY_TOKEN unset); skipping %s", actor_id)
        return []
    if not actor_id:
        logging.info("No Apify actor id provided; skipping.")
        return []

    # run-sync-get-dataset-items blocks until the run finishes and streams back
    # the dataset in one call — ideal for our short, low-volume scrapes.
    url = f"{APIFY_BASE_URL}/acts/{actor_id}/run-sync-get-dataset-items"
    try:
        resp = requests.post(
            url,
            params={"token": APIFY_TOKEN},
            json=run_input,
            timeout=RUN_TIMEOUT,
        )
        if resp.status_code not in (200, 201):
            logging.warning(
                "Apify actor %s returned %s: %s",
                actor_id, resp.status_code, resp.text[:200],
            )
            return []
        items = resp.json()
        return items if isinstance(items, list) else []
    except Exception as e:  # noqa: BLE001
        logging.warning("Apify actor %s failed: %s", actor_id, e)
        return []
