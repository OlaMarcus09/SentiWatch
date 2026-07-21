import os
import re
import logging
from typing import Dict, Any

from dotenv import load_dotenv

from database import supabase, supabase_admin
from constants import VALID_CATEGORIES, VALID_RISKS, VALID_SENTIMENTS
from services import llm_client

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

NEGATIVE SIGNAL CATEGORIES (treat ALL of these as negative, even with no legal/regulatory keywords):
- Money taken, not refunded, or "no refund" / "no delivery" outcomes
- Property, land, investment, or contract disputes where the customer got nothing
- Any headline where a company "took", "collected", or "received" money and failed to deliver a service/product/asset
- Allegations of bribery, corruption, embezzlement, racketeering, money laundering, tax evasion, or trafficking (drug, arms, pharma) — even if unproven or reported by a third party
- Theft, robbery, or unauthorized use of customer funds/assets
- Years-long unresolved complaints ("X years later", "still no response", "still waiting")
- Court cases, petitions, or investigative journalism pieces framed around a wronged customer, even without words like "fraud" or "scam"
- Any story where the entity is the one accused of withholding value from another party

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

6. "PWAN Homes Took Couple's N12m. No Land, No Refund 3 Years Later"
   → {"sentiment":"negative","category":"fraud","sub_category":"fraud_allegation","severity":9,"confidence":0.95,"risk":"critical","root_cause":"Company took payment, delivered no land or refund for years","reason":"Unresolved financial harm to a customer is a severe trust violation even without legal keywords"}

7. "Investigation exposes company's alleged links to embezzlement and shell payments"
   → {"sentiment":"negative","category":"fraud","sub_category":"fraud_allegation","severity":9,"confidence":0.9,"risk":"critical","root_cause":"Alleged embezzlement and financial misconduct","reason":"Financial crime allegation regardless of formal charges"}

Rules:
- If text contains fraud, EFCC, police, court, bribery, corruption, embezzlement, money laundering, trafficking, or racketeering → category=fraud or regulatory, risk=critical/high
- If text describes money/value taken with no delivery, refund, or resolution → category=fraud (or customer_complaint if smaller-scale), risk=high/critical, sentiment=negative — regardless of whether "fraud/scam" is explicitly stated
- If text is a customer compliment → category=customer_praise, risk=low
- If text is a customer complaint without financial loss → category=customer_complaint or product_quality
- If text is about regulations, CBN, NAFDAC → category=regulatory
- If uncertain between negative and neutral, bias towards NEGATIVE — silence on outcome (e.g. no refund given, no resolution stated) is itself a negative signal
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


# ---------------------------------------------------------------------------
# Deterministic negative-signal backstop
# ---------------------------------------------------------------------------
# The LLM occasionally under-calls clear financial-harm / crime stories as
# "neutral" (e.g. "PWAN Homes Took Couple's N12m. No Land, No Refund 3 Years
# Later"). Since scoring treats neutral as ZERO risk, one such miss makes a
# critical story invisible. These patterns act as a hard safety net: if the
# raw text matches, we refuse to let the mention stay neutral regardless of
# what the model returned.

# Each entry: (compiled regex, severity_floor, risk_floor)
_NEGATIVE_SIGNAL_PATTERNS = [
    # Money taken / no delivery / no refund outcomes
    (re.compile(r"\bno\s+refund\b", re.I), 8, "high"),
    (re.compile(r"\bno\s+(?:land|delivery|product|service|response|resolution)\b", re.I), 8, "high"),
    (re.compile(r"\b(?:took|collected|received|paid|deposited)\b.{0,40}\b(?:but|yet|however|still)?\b.{0,40}\b(?:no\s|never|failed|nothing)", re.I), 8, "high"),
    (re.compile(r"\bstill\s+(?:waiting|no\s+(?:refund|response|land|delivery))\b", re.I), 8, "high"),
    (re.compile(r"\b\d+\s+years?\s+later\b", re.I), 7, "high"),
    # Financial-crime allegations (even if unproven / third-party reported)
    (re.compile(r"\b(?:fraud|scam|scammed|defraud(?:ed)?|ponzi)\b", re.I), 9, "critical"),
    (re.compile(r"\b(?:bribery|bribe[ds]?|corrupt(?:ion)?)\b", re.I), 9, "critical"),
    (re.compile(r"\b(?:embezzle(?:ment|d)?|misappropriat)", re.I), 9, "critical"),
    (re.compile(r"\bmoney\s+launder", re.I), 9, "critical"),
    (re.compile(r"\b(?:racketeer|extortion)", re.I), 9, "critical"),
    (re.compile(r"\btax\s+(?:evasion|fraud)\b", re.I), 8, "high"),
    (re.compile(r"\b(?:drug|arms|pharma(?:ceutical)?|human)\s+traffick", re.I), 9, "critical"),
    (re.compile(r"\b(?:theft|robbery|stole|stolen|looted)\b", re.I), 8, "high"),
    # Legal / enforcement framing
    (re.compile(r"\b(?:EFCC|ICPC|arraign|indict|petition|lawsuit|sued|court\s+case)\b", re.I), 8, "high"),
]


def detect_forced_negative(text: str):
    """
    Scan raw mention text for hard negative signals the LLM must never bury as
    neutral. Returns (severity_floor, risk_floor) for the strongest match, or
    None if no signal is present.
    """
    if not text:
        return None

    best = None  # (severity_floor, risk_floor)
    for pattern, sev_floor, risk_floor in _NEGATIVE_SIGNAL_PATTERNS:
        if pattern.search(text):
            if best is None or sev_floor > best[0]:
                best = (sev_floor, risk_floor)
    return best


_RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def validate_ai_output(result: Dict[str, Any], text: str = "") -> Dict[str, Any]:

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

    # Deterministic backstop: never let a hard negative signal sit as neutral
    # (or as a low-severity/low-risk negative). Scoring treats neutral as ZERO,
    # so this guarantees financial-harm / crime stories always move the score.
    forced = detect_forced_negative(text)
    if forced:
        sev_floor, risk_floor = forced

        if result["sentiment"] != "negative":
            logging.warning(
                "Backstop override: LLM said '%s' but text matched a hard "
                "negative signal — forcing negative. Text: %.80s",
                result["sentiment"], text,
            )
            result["sentiment"] = "negative"
            result["reason"] = (
                f"[Auto-flagged] {result['reason']} "
                f"(rule: hard negative signal detected in text)"
            ).strip()
            # A general/praise category no longer fits a forced negative.
            if result["category"] in ("general", "customer_praise"):
                result["category"] = "fraud"

        # Raise severity/risk to at least the matched floor.
        result["severity"] = max(result["severity"], sev_floor)
        if _RISK_ORDER.get(result["risk"], 0) < _RISK_ORDER[risk_floor]:
            result["risk"] = risk_floor

    return result


def call_groq(text: str) -> Dict[str, Any]:
    """
    Runs per-mention sentiment analysis through the configured LLM provider
    (AgentRouter if set, else Groq). Name kept for backward-compat with callers.
    """
    return llm_client.chat_json(
        system=SYSTEM_PROMPT,
        user=f"Analyze this mention: {text}",
        model=llm_client.SENTIMENT_MODEL,
        temperature=0,
    )


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


RELEVANCE_SYSTEM_PROMPT = """
You are a strict relevance classifier for a brand-reputation monitoring system.
Decide whether a piece of text is genuinely ABOUT the given entity (a business,
person, influencer, or property brand) — not merely containing the word.

Reject text where the entity name appears only as a common English word, a
place/street name, an unrelated person with the same name, a stock-ticker list,
or an incidental mention that carries no reputational signal about the entity.
Accept text that discusses the entity's products, service, conduct, news,
customer experience, or public perception.

Return ONLY valid JSON, no markdown:
{"relevant": true|false, "confidence": 0.0-1.0, "reason": "short explanation"}
"""


def _llm_relevance_check(
    text: str,
    brand_name: str,
    profile_type: str = "business",
    competitors: list = None,
) -> bool:
    """
    LLM judge stage. Returns True if the model is confident the text is about
    the entity. Fails OPEN (returns True) on any error so a gateway outage
    never silently drops the whole batch.
    """
    competitors = competitors or []
    comp_line = f"\nKnown competitors (do not confuse with the entity): {', '.join(competitors)}" if competitors else ""
    user = (
        f"Entity name: {brand_name}\n"
        f"Entity type: {profile_type}{comp_line}\n\n"
        f"Text to classify:\n\"\"\"\n{text[:1500]}\n\"\"\""
    )
    try:
        result = llm_client.chat_json(
            system=RELEVANCE_SYSTEM_PROMPT,
            user=user,
            model=llm_client.RELEVANCE_MODEL,
            temperature=0,
        )
        relevant = bool(result.get("relevant", True))
        confidence = float(result.get("confidence", 0.0))
        if not relevant or confidence < 0.6:
            logging.info(
                "Relevance rejected (%.2f): %s",
                confidence, str(result.get("reason", ""))[:120],
            )
            return False
        return True
    except Exception as e:
        logging.warning("Relevance LLM check failed, failing open: %s", e)
        return True


def is_relevant(
    text: str,
    brand_name: str,
    profile_type: str = "business",
    competitors: list = None,
) -> bool:
    """
    Two-stage gatekeeper that blocks junk mentions before full analysis.

    Stage 1 (free): length + normalized brand-token presence.
    Stage 2 (LLM): semantic judge — is the text actually ABOUT the entity?
    """

    # ── Stage 1: cheap prefilter ──
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

    # ── Stage 2: LLM semantic judge ──
    return _llm_relevance_check(text, brand_name, profile_type, competitors)


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
def _fetch_entity_context(entity_id: str) -> tuple:
    """
    Single read to get the entity's profile_type and linked competitor names,
    used to sharpen the relevance judge. Returns (profile_type, [competitors]).
    Best-effort: returns sensible defaults on any failure.
    """
    profile_type = "business"
    competitors = []
    if not entity_id:
        return profile_type, competitors
    try:
        ent = (
            supabase_admin.table("monitored_entities")
            .select("profile_type")
            .eq("id", entity_id)
            .maybe_single()
            .execute()
        )
        if ent and ent.data and ent.data.get("profile_type"):
            profile_type = ent.data["profile_type"]

        links = (
            supabase_admin.table("competitor_links")
            .select("competitor_entity_id")
            .eq("primary_entity_id", entity_id)
            .execute()
        )
        comp_ids = [r["competitor_entity_id"] for r in (links.data or [])]
        if comp_ids:
            comps = (
                supabase_admin.table("monitored_entities")
                .select("name")
                .in_("id", comp_ids)
                .execute()
            )
            competitors = [c["name"] for c in (comps.data or []) if c.get("name")]
    except Exception as e:
        logging.warning("Could not load entity context for relevance gate: %s", e)
    return profile_type, competitors


def analyze_and_store_sentiment(entity_id: str = None, brand_name: str = None, live_context: str = ""):
    """
    Main pipeline. Accepts optional entity_id, brand_name, and live_context
    so the gatekeeper, entity filter, and Tavily integrations work perfectly.
    """
    # Require at least one configured LLM provider (AgentRouter or Groq).
    if not (llm_client._use_agentrouter() or GROQ_API_KEY):
        logging.error("No LLM provider configured (set AGENTROUTER_* or GROQ_API_KEY)")
        return {"processed": 0, "failed": 0}

    processed, failed = 0, 0

    # Load persona + competitors once to sharpen the relevance gate.
    profile_type, competitors = _fetch_entity_context(entity_id)

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
                ai_result = validate_ai_output(ai_result, live_context[:2000])
                
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

        if not is_relevant(text, brand_name, profile_type, competitors):
            logging.info(f"Skipped irrelevant mention {mention_id}")
            failed += 1
            continue

        try:
            ai_result = call_groq(text)
            ai_result = validate_ai_output(ai_result, text)
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