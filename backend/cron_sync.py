# backend/cron_sync.py
import time
import requests
from database import supabase
import os
import sys
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")

# Sent on every internal POST so the backend's verify_internal_key dependency
# accepts these machine-to-machine calls.
INTERNAL_HEADERS = {"X-Internal-Key": INTERNAL_API_KEY}


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

    logging.warning("⚠️ Backend did not respond to warmup; proceeding anyway.")
    return False


def run_automated_pipeline():
    """
    Runs the full reputation pipeline once:
    1. Fetch all monitored brands
    2. Scrape mentions (sync)
    3. Analyze sentiment (AI)
    4. Calculate risk scores
    """
    logging.info(f"⏰ Background sync started at {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Wake the (possibly sleeping) free-tier web service before hitting endpoints.
    wait_for_backend()

    try:
        # 1. Fetch every monitored brand from the database
        entities_res = supabase.table("monitored_entities").select("id, name").execute()
        entities = entities_res.data or []
        
        if not entities:
            logging.info("No monitored entities found. Exiting.")
            return
        
        logging.info(f"Found {len(entities)} entities to process.")
        
        # 2. Trigger Scrapers for each entity
        for entity in entities:
            entity_id = entity["id"]
            name = entity["name"]
            logging.info(f"🔄 Syncing tracks for: {name}")
            
            try:
                response = requests.post(
                    f"{BACKEND_URL}/sync/{entity_id}?brand_name={name}",
                    headers=INTERNAL_HEADERS,
                    timeout=30
                )
                if response.status_code == 200:
                    logging.info(f"✅ Sync successful for {name}")
                else:
                    logging.warning(f"⚠️ Sync returned {response.status_code} for {name}")
            except Exception as e:
                logging.error(f"❌ Sync error for {name}: {e}")
        
        # 3. Process Sentiments — pass entity context so gatekeeper works
        logging.info("🧠 Running sentiment scoring engines...")
        for entity in entities:
            try:
                response = requests.post(
                    f"{BACKEND_URL}/analyze",
                    params={
                        "entity_id": entity["id"],
                        "brand_name": entity["name"]
                    },
                    headers=INTERNAL_HEADERS,
                    timeout=120  # Groq might take a few seconds per mention
                )
                if response.status_code == 200:
                    logging.info(f"✅ Analysis complete for {entity['name']}")
                else:
                    logging.warning(f"⚠️ Analysis returned {response.status_code} for {entity['name']}")
            except Exception as e:
                logging.error(f"❌ Analysis error for {entity['name']}: {e}")

        # 4. Evaluate Risk Calculations and Fire Alerts
        logging.info("🚨 Recalculating alert thresholds...")
        for entity in entities:
            try:
                response = requests.post(
                    f"{BACKEND_URL}/calculate-risk/{entity['id']}",
                    headers=INTERNAL_HEADERS,
                    timeout=30
                )
                if response.status_code == 200:
                    logging.info(f"✅ Risk calculation complete for {entity['name']}")
                else:
                    logging.warning(f"⚠️ Risk calculation returned {response.status_code} for {entity['name']}")
            except Exception as e:
                logging.error(f"❌ Risk calculation error for {entity['name']}: {e}")
        
        logging.info("✅ System sync cycle complete.")
        
    except Exception as e:
        logging.error(f"❌ Pipeline failed: {e}")
        raise

if __name__ == "__main__":
    run_automated_pipeline()
    sys.exit(0)  # Important: Exit cleanly so the scheduler can run again next cycle