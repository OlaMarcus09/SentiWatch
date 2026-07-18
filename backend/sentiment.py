import os
import json
import logging
import time
from typing import Dict, Any

from groq import Groq
from dotenv import load_dotenv

from database import supabase, supabase_admin
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

# 🔥 NEW: Smarter SYSTEM_PROMPT with root cause detection
SYSTEM_PROMPT = """
You are SentiWatch AI, an expert Brand Reputation Intelligence Analyst for the Nigerian market.
Task: Analyze if the text damages or enhances brand trust. Identify the root cause.

Output: Return ONLY valid JSON. No markdown formatting.

Schema:
{
    "sentiment": "positive|neutral|negative",
    "category": "fraud|regulatory|customer_praise|customer_complaint|product_quality|operations|cyber|security|financial|leadership|general",
    "sub_category": "fund_lockup|delivery_delay|security_breach|service_speed|pricing|competitor_mention|award|partnership|reputation_attack|general",
    "severity": 1-10,
    "confidence": 0.0-1.0,
    "risk": "low|medium|high|critical",
    "root_cause": "Brief 5-10 word explanation of what triggered this mention",
    "reason": "Short sentence explaining the decision."
}

Examples:

1. "Thanks to Cowrywise for saving me from a losing streak in trading!"
   → {"sentiment":"positive","category":"customer_praise","sub_category":"general","severity":6,"confidence":0.95,"risk":"low","root_cause":"Customer praises platform for saving from losses","reason":"Customer appreciation with no complaints"}

2. "My funds were locked on Cowrywise for 3 days with no explanation!"
   → {"sentiment":"negative","category":"customer_complaint","sub_category":"fund_lockup","severity":8,"confidence":0.98,"risk":"high","root_cause":"Funds locked without explanation causing customer distress","reason":"Operational issue causing customer frustration"}

3. "EFCC Arraigns CEO Over N36m Fraud"
   → {"sentiment":"negative","category":"fraud","sub_category":"legal_charge","severity":10,"confidence":0.99,"risk":"critical","root_cause":"CEO arraigned on fraud charges by EFCC","reason":"Fraud investigation is a severe reputational threat"}

4. "Company announces office holiday hours"
   → {"sentiment":"neutral","category":"general","sub_category":"operational_update","severity":1,"confidence":0.95,"risk":"low","root_cause":"Routine operational update","reason":"Routine operational announcement"}

5. "Huge queues at this branch in Lekki. Very disappointing service speed."
   → {"sentiment":"negative","category":"customer_complaint","sub_category":"service_speed","severity":7,"confidence":0.92,"risk":"medium","root_cause":"Slow service causing customer dissatisfaction","reason":"Customer complaint about service speed"}

Rules:
- If text contains fraud, EFCC, police, court, or scandals → category=fraud or regulatory, risk=critical/high
- If text is a customer compliment → category=customer_praise, risk=low
- If text is a customer complaint → category=customer_complaint or product_quality
- If text is about regulations, CBN, NAFDAC → category=regulatory
- If uncertain between negative and neutral, bias towards NEGATIVE
- Keep root_cause under 10 words
- Be precise. Return ONLY JSON.
"""

# Valid sub-categories (for validation)
VALID_SUB_CATEGORIES = {
    "fund_lockup", "delivery_delay", "security_breach", "service_speed",
    "pricing", "competitor_mention", "award", "partnership", 
    "reputation_attack", "legal_charge", "operational_update",
    "general", "data_breach", "fraud_allegation", "regulatory_fine",
    "customer_feedback", "product_defect", "staff_conduct"
}


def validate_ai_output(result: Dict[str, Any]) -> Dict[str, Any]:

    raw_sentiment = str(result.get("sentiment", "neutral")).lower().strip()
    raw_risk = str(result.get("risk", "low")).lower().strip()
    raw_category = str(result.get("category", "general")).lower().strip()
    raw_sub_category = str(result.get("sub_category", "general")).lower().strip()

    result["sentiment"] = raw_sentiment if raw_sentiment in VALID_SENTIMENTS else "neutral"
    result["risk"] = raw_risk if raw_risk in VALID_RISKS else "low"
    result["category"] = raw_category if raw_category in VALID_CATEGORIES else "general"
    result["sub_category"] = raw_sub_category if raw_sub_category in VALID_SUB_CATEGORIES else "general"

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

    result["root_cause"] = str(result.get("root_cause", "No root cause identified")).strip()[:100]
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
    Filters by entity_id and excludes already-processed mentions.
    Uses supabase_admin to bypass RLS for backend reads.
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
    Gatekeeper that blocks junk mentions from ever reaching Groq.
    Returns True only if the mention is worth analysing.
    """

    # Too short to be meaningful
    if len(text.strip()) < 15:
        return False

    # Must actually mention the brand (case-insensitive).
    # Normalize spacing on both sides so an entity named "AprokoDoctor"
    # matches text that writes it as "Aproko Doctor" (or vice versa).
    if brand_name:
        brand_norm = brand_name.lower().replace(" ", "")
        text_norm = text.lower().replace(" ", "")
        if brand_norm not in text_norm:
            return False

    return True


def save_sentiment(mention_id: str, result: Dict[str, Any]):
    payload = {
        "mention_id": mention_id,
        "label": result["sentiment"],
        "confidence": result["confidence"],
        "severity": result["severity"],
        "category": result["category"],
        "sub_category": result.get("sub_category", "general"),
        "risk_level": result["risk"],
        "root_cause": result.get("root_cause", "No root cause identified"),
        "reason": result["reason"]
    }
    supabase_admin.table("sentiment_results").insert(payload).execute()


# Synchronous pipeline. All Groq/Supabase calls below are blocking, so this
# stays a plain def. Async callers (e.g. run_analysis_pipeline) invoke it via
# asyncio.to_thread to keep the event loop unblocked.
def analyze_and_store_sentiment(entity_id: str = None, brand_name: str = None, live_context: str = ""):
    """
    Main pipeline. Accepts optional entity_id, brand_name, and live_context
    so the gatekeeper, entity filter, and Tavily integrations work perfectly.
    """
    if not GROQ_API_KEY:
        logging.error("Missing GROQ_API_KEY")
        return {"processed": 0, "failed": 0}

    processed, failed = 0, 0

    # 1. New Pivot Flow: If Tavily returned real-time web context, analyze it as a premium node
    if live_context and live_context != "No recent web mentions found.":
        logging.info(f"Analyzing live web search context from Tavily for {brand_name}...")
        try:
            # We create a structured pseudo-mention to capture the live search event
            mention_res = supabase_admin.table("mentions").insert({
                "entity_id": entity_id,
                "source": "tavily_live_search",
                "content": f"Live Context Snapshot: {live_context[:400]}...",
                "status": "processed"
            }).execute()
            
            if mention_res.data:
                live_mention_id = mention_res.data[0]["id"]
                
                # Pass the raw web data directly to Groq using your robust engine
                ai_result = call_groq(live_context[:2000]) # Cap text to prevent token blowing
                ai_result = validate_ai_output(ai_result)
                
                # Save it to sentiment_results using your built-in saver
                save_sentiment(live_mention_id, ai_result)
                processed += 1
                logging.info(f"Live Tavily Context analyzed successfully. Risk score impact mapped.")
        except Exception as e:
            logging.error(f"Failed to process live context node: {e}")
            failed += 1

    # 2. Existing Scraped Data Flow: Fetch raw mentions from database tables
    mentions = get_unprocessed_mentions(entity_id=entity_id, limit=20)

    if not mentions:
        logging.info("No new database-scraped mentions to process.")
        return {"processed": processed, "failed": failed}

    logging.info(f"Found {len(mentions)} new database mentions to analyse.")

    for mention in mentions:
        mention_id = mention["id"]
        text = mention.get("content", "")

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
                f"category={ai_result['category']} | "
                f"risk={ai_result['risk']} | "
                f"severity={ai_result['severity']} | "
                f"root_cause={ai_result.get('root_cause', 'N/A')}"
            )
            processed += 1

        except Exception as e:
            logging.error(f"Failed analysis for {mention_id}: {e}")
            failed += 1

    logging.info(f"Done. Processed={processed}, Failed={failed}")
    return {"processed": processed, "failed": failed}


if __name__ == "__main__":
    print(analyze_and_store_sentiment())