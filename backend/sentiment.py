import os
import json
import logging
import time
from typing import Dict, Any

from groq import Groq
from dotenv import load_dotenv

from database import supabase_admin
from constants import VALID_CATEGORIES, VALID_RISKS, VALID_SENTIMENTS

load_dotenv()

# Configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
MAX_RETRIES = 3
REQUEST_TIMEOUT = 60

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

SYSTEM_PROMPT = """
You are SentiWatch AI, an expert Brand Reputation Intelligence Analyst.
Task: Analyze if the text damages or enhances brand trust.
Output: Return ONLY valid JSON. No markdown formatting.

Schema:
{
    "sentiment":"positive|neutral|negative",
    "severity":1-10,
    "confidence":0.0-1.0,
    "category":"fraud|legal|regulatory|customer_service|product_quality|operations|cyber|security|financial|leadership|general",
    "risk":"low|medium|high|critical",
    "reason":"Short sentence explaining the decision."
}

Examples:
1. Headline: "EFCC Arraigns CEO Over Fraud" -> {"sentiment":"negative", "severity":10, "confidence":0.99, "category":"fraud", "risk":"critical", "reason":"Fraud investigation is a severe reputational threat."}
2. Headline: "Company Wins Industry Innovation Award" -> {"sentiment":"positive", "severity":7, "confidence":0.98, "category":"general", "risk":"low", "reason":"Innovation awards enhance brand perception."}
3. Headline: "Company announces office holiday hours" -> {"sentiment":"neutral", "severity":1, "confidence":0.95, "category":"general", "risk":"low", "reason":"Routine operational update."}

Rules:
- If text involves crime, fraud, police, court, or scandals, classify as NEGATIVE regardless of tone.
- If the content is purely operational (office hours, holidays), classify as NEUTRAL.
- If uncertain between negative and neutral, bias towards NEGATIVE.
- If output is invalid JSON, the system fails. Be precise.
"""


def validate_ai_output(result: Dict[str, Any]) -> Dict[str, Any]:

    raw_sentiment = str(result.get("sentiment", "neutral")).lower().strip()
    raw_risk = str(result.get("risk", "low")).lower().strip()
    raw_category = str(result.get("category", "general")).lower().strip()

    result["sentiment"] = raw_sentiment if raw_sentiment in VALID_SENTIMENTS else "neutral"
    result["risk"] = raw_risk if raw_risk in VALID_RISKS else "low"
    result["category"] = raw_category if raw_category in VALID_CATEGORIES else "general"

    try:
        severity = int(result.get("severity", 5))
        result["severity"] = max(1, min(10, severity))
    except Exception:
        result["severity"] = 5

    try:
        confidence = float(result.get("confidence", 0.75))
        result["confidence"] = max(0.0, min(1.0, confidence))
    except Exception:
        result["confidence"] = 0.75

    result["reason"] = str(result.get("reason", "No reason provided")).strip()
    return result


def call_groq(text: str) -> Dict[str, Any]:
    client = Groq(api_key=GROQ_API_KEY)

    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Analyze this mention: {text}"}
                ],
                temperature=0,
                response_format={"type": "json_object"}
            )
            content = response.choices[0].message.content
            return json.loads(content)

        except Exception as e:
            logging.warning(f"Groq attempt {attempt + 1} failed: {e}")
            time.sleep(2)

    raise Exception("Groq service failed after retries.")


def get_unprocessed_mentions(entity_id: str = None, limit: int = 20):
    """
    FIX 1: Now filters by entity_id and uses .not_.in_() to exclude
    already-processed mentions at the database level, so Groq only
    ever sees fresh, unanalysed content.
    """

    # 1. Fetch IDs of mentions that already have a sentiment score
    processed_res = (
        supabase_admin
        .table("sentiment_results")
        .select("mention_id")
        .execute()
    )
    processed_ids = [row["mention_id"] for row in processed_res.data]

    # 2. Build the base query — filter by entity_id if provided
    query = supabase_admin.table("mentions").select("*")

    if entity_id:
        query = query.eq("entity_id", entity_id)

    # 3. Exclude already-processed mentions
    if processed_ids:
        query = query.not_.in_("id", processed_ids)

    # 4. Newest first, hard limit
    mentions_res = query.order("created_at", desc=True).limit(limit).execute()

    return mentions_res.data


def is_relevant(text: str, brand_name: str) -> bool:
    """
    FIX 2: Gatekeeper that blocks junk mentions from ever
    reaching Groq — saving tokens and keeping scores clean.
    Returns True only if the mention is worth analysing.
    """

    # Too short to be meaningful
    if len(text.strip()) < 15:
        return False

    # Must actually mention the brand (case-insensitive)
    if brand_name and brand_name.lower() not in text.lower():
        return False

    return True


def save_sentiment(mention_id: str, result: Dict[str, Any]):
    payload = {
        "mention_id": mention_id,
        "label": result["sentiment"],
        "confidence": result["confidence"],
        "severity": result["severity"],
        "category": result["category"],
        "risk_level": result["risk"],
        "reason": result["reason"]
    }

    response = supabase_admin.table("sentiment_results").insert(payload).execute()

    # supabase-py doesn't always raise on a failed/blocked write — it can
    # just come back with empty data. Check explicitly so a silent RLS
    # rejection doesn't get logged and counted as "processed".
    if not getattr(response, "data", None):
        raise Exception(
            f"sentiment_results insert returned no data for mention {mention_id} "
            f"(response: {response})"
        )


def analyze_and_store_sentiment(entity_id: str = None, brand_name: str = None):
    """
    Main pipeline. Accepts optional entity_id and brand_name
    so the gatekeeper and entity filter work correctly.
    """

    if not GROQ_API_KEY:
        logging.error("Missing GROQ_API_KEY")
        return {"processed": 0, "failed": 0}

    # FIX 1: Pass entity_id so only the right mentions are fetched
    mentions = get_unprocessed_mentions(entity_id=entity_id, limit=20)

    if not mentions:
        logging.info("No new mentions to process.")
        return {"processed": 0, "failed": 0}

    processed, failed = 0, 0
    logging.info(f"Found {len(mentions)} new mentions to analyse.")

    for mention in mentions:
        mention_id = mention["id"]
        text = mention.get("content", "")

        # FIX 2: Gatekeeper — skip junk before hitting Groq
        if not is_relevant(text, brand_name):
            logging.info(f"Skipped irrelevant mention {mention_id}")
            failed += 1
            continue

        try:
            ai_result = call_groq(text)
            ai_result = validate_ai_output(ai_result)
            save_sentiment(mention_id, ai_result)
            logging.info(
                f"Mention {mention_id} → "
                f"sentiment={ai_result['sentiment']} | "
                f"risk={ai_result['risk']} | "
                f"severity={ai_result['severity']}"
            )
            processed += 1

        except Exception as e:
            logging.error(f"Failed analysis for {mention_id}: {e}")
            failed += 1

    logging.info(f"Done. Processed={processed}, Failed={failed}")
    return {"processed": processed, "failed": failed}


if __name__ == "__main__":
    print(analyze_and_store_sentiment())
