import os
import json
import logging
import resend
from dotenv import load_dotenv
from database import supabase, supabase_admin
from scoring import calculate_entity_score
from constants import EMAIL_ALERT_THRESHOLD
from services import llm_client

load_dotenv()
resend.api_key = os.getenv("RESEND_API_KEY")


RECOMMENDATION_SYSTEM_PROMPT = """
You are SentiWatch's crisis-response strategist for the Nigerian market.
Given an entity's current reputation metrics, produce 3 to 5 DISCRETE,
prioritized recommendations — one per major risk driver — that the owner can
act on immediately.

Tailor tone and tactics to the entity type (business, influencer, student,
real_estate). Be concrete and specific to the drivers given; avoid generic
advice.

Return ONLY valid JSON (no markdown) in exactly this shape:
{
  "recommendations": [
    {
      "title": "short imperative headline",
      "action_plan": "2-4 concrete steps the owner should take",
      "priority": "critical" | "high" | "medium" | "low",
      "category": "the risk category this addresses",
      "effort": "low" | "medium" | "high",
      "eta": "e.g. 'Within 2 hours', 'Within 24 hours', 'This week'"
    }
  ]
}
Order the array from highest to lowest priority.
"""

VALID_PRIORITIES = {"critical", "high", "medium", "low"}


def generate_ai_recommendations(
    score: int,
    status: str,
    category_breakdown: dict,
    top_root_causes: list,
    brand_name: str = "Your Profile",
    profile_type: str = "business",
    competitors: list = None,
) -> list:
    """
    Produces a prioritized list of 3-5 discrete recommendations via the LLM.
    Returns [] on any failure so the caller can fall back to the template
    playbook — the pipeline must never break because the LLM is unavailable.
    """
    competitors = competitors or []
    comp_line = f"\nKnown competitors: {', '.join(competitors)}" if competitors else ""
    causes_line = "; ".join(str(c) for c in (top_root_causes or [])) or "None identified"

    user = (
        f"Entity: {brand_name}\n"
        f"Entity type: {profile_type}{comp_line}\n"
        f"Risk score: {score}/100 (status: {status})\n"
        f"Category breakdown (mentions per category): {json.dumps(category_breakdown)}\n"
        f"Top root causes: {causes_line}\n\n"
        f"Generate the prioritized recommendations now."
    )

    try:
        result = llm_client.chat_json(
            system=RECOMMENDATION_SYSTEM_PROMPT,
            user=user,
            model=llm_client.RECOMMENDATION_MODEL,
            temperature=0.2,
        )
        recs = result.get("recommendations", [])
        cleaned = []
        for r in recs:
            if not isinstance(r, dict):
                continue
            priority = str(r.get("priority", "medium")).lower().strip()
            if priority not in VALID_PRIORITIES:
                priority = "medium"
            cleaned.append({
                "title": str(r.get("title", "Reputation action")).strip()[:120],
                "action_plan": str(r.get("action_plan", "")).strip(),
                "priority": priority,
                "category": str(r.get("category", "general")).strip()[:50],
                "effort": str(r.get("effort", "medium")).lower().strip()[:10],
                "eta": str(r.get("eta", "")).strip()[:40],
                "status": "active",
            })
        return cleaned[:5]
    except Exception as e:
        logging.warning("AI recommendation generation failed, will fall back: %s", e)
        return []


# ──────────────────────────────────────────────────────
# Personalized Recommendation Generator (Pivot Version)
# ──────────────────────────────────────────────────────
def generate_personalized_recommendation(
    score: int,
    status: str,
    category_breakdown: dict,
    top_root_causes: list,
    brand_name: str = "Your Profile",
    profile_type: str = "business"
) -> str:
    """
    Generates a persona-specific, actionable recommendation based on:
    - Risk score band
    - Category breakdown (what's driving the risk)
    - Profile persona (student, influencer, real_estate, business)
    """
    
    # Determine the primary category driver
    if not category_breakdown:
        primary_category = "general"
        primary_count = 0
    else:
        primary_category = max(category_breakdown, key=category_breakdown.get)
        primary_count = category_breakdown.get(primary_category, 0)
    
    # Persona-specific playbooks tailored for the Nigerian ecosystem & global exit/growth constraints
    persona_advice = {
        "student": {
            "fraud": "🔴 **Visa & Admission Blacklist Warning**\n\n"
                f"**ALERT TRIGGER:** {primary_count} mentions relating to academic dishonesty, payment discrepancies, or fraudulent listings flagged.\n\n"
                f"**IMMEDIATE CRISIS PROTOCOL:**\n"
                f"1. **Within 2 hours:** Identify the source thread (Nairaland, X, or public forums) linking your name to this claim.\n"
                f"2. **Within 12 hours:** If this is an identity mix-up, issue a clear pinned disclaimer separating your passport identity/legal name from the accused party.\n"
                f"3. **Visa Precaution:** Embassies heavily screen background data. Prepare certified bank statements and clear institutional transcripts to override digital anomalies during your interview.",
            
            "customer_complaint": "🟠 **Digital Footprint Vetting Flag**\n\n"
                f"**ALERT TRIGGER:** {primary_count} flags matching aggressive arguments, cyberbullying, or toxic online engagement.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Immediate (4 hours):** De-escalate active public disputes. Delete or archive high-volatility threads or comment histories.\n"
                f"2. **Within 24 hours:** Clean up open social media profiles. Ensure posts containing explicit language or highly sensitive content are set to private.\n"
                f"3. **Architect's Advice:** Visa officers look for flags regarding social instability. Your digital presence must present you as an upstanding student traveler.",
            
            "general": "🟡 **Student Profile Optimization Required**\n\n"
                f"Elevated digital chatter detected. Scan your history for political volatility or unverified professional claims that could cause a background verification delay during immigration checks."
        },
        
        "influencer": {
            "fraud": "🔴 **Brand-Safety Emergency: Sponsor Trust Protection**\n\n"
                f"**ALERT TRIGGER:** {primary_count} scam/fraud allegations targeting your endorsements, giveaways, or business deals.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Immediate (1 hour):** Issue a crisp holding statement acknowledging the situation without accepting legal liability.\n"
                f"2. **Within 6 hours:** Reach out privately to active corporate brand managers/sponsors to assure them an investigation is underway before they issue corporate pull-out statements.\n"
                f"3. **Within 24 hours:** Publish clear proof, receipts, or legal disclaimers resolving the conflict.",
            
            "customer_complaint": "🟠 **PR De-escalation Protocol (Cancel Culture Defense)**\n\n"
                f"**ALERT TRIGGER:** {primary_count} negative call-outs or call-to-actions trending.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 2 hours:** Do not turn off comments completely—this amplifies the narrative. Restrict targeted harassment keywords using app filters instead.\n"
                f"2. **Within 12 hours:** Record or draft an authentic, non-defensive clarification or apology if an error occurred.\n"
                f"3. **Within 24 hours:** Pivot content temporarily to community value or silence to let the algorithm algorithmically cool down.",
            
            "general": "🟡 **Influencer Sentiment Shadow Shift**\n\n"
                f"Unfavorable discussion spikes detected. Review your latest mentions to protect upcoming monetization and PR campaigns."
        },

        "real_estate": {
            "fraud": "🔴 **Real Estate Trust & Legal Risk Alert**\n\n"
                f"**ALERT TRIGGER:** {primary_count} mentions flagging allocation delays, dual-allocation disputes, or 'Omo Onile' / land grabber issues.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Immediate (2 hours):** Review documentation matching the specific estate or project mentioned.\n"
                f"2. **Within 12 hours:** Issue a project status update to all existing clients to preempt an investor panic or mass refund requests.\n"
                f"3. **Within 24 hours:** Provide transparent timelines for land physical documentation verification.",
            
            "customer_complaint": "🟠 **Property Portfolio Reputation Management**\n\n"
                f"**ALERT TRIGGER:** {primary_count} complaints regarding maintenance, structural quality, or structural delivery timelines.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 4 hours:** Assign a dedicated customer relations representative to reply directly to public complaint posts.\n"
                f"2. **Within 24 hours:** Take the conversation offline by extending an internal resolution ticket/direct messaging sequence.\n"
                f"3. **Long-term:** Publish operational improvements or renovation highlights to push down historical search engine complaints."
        },

        "business": {
            "fraud": "🔴 **Immediate Trust Protection Protocol**\n\n"
                f"**ALERT TRIGGER:** {primary_count} fraud-related mentions detected. Customers are raising concerns about financial safety.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Immediate (2 hours):** Issue a formal statement on your verified channels detailing your active safety standards.\n"
                f"2. **Within 4 hours:** Alert compliance teams and legal advisors to review system vulnerabilities.\n"
                f"3. **Within 24 hours:** Email affected client segments providing transparent protection actions.",
            
            "customer_complaint": "🟠 **Operational Friction Triage**\n\n"
                f"**ALERT TRIGGER:** {primary_count} customer service complaints logged.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 4 hours:** Identify the specific breaking bottleneck (downtime, payment gateways, shipping lag).\n"
                f"2. **Within 8 hours:** Deploy support agents to reply empathetically to public threads.\n"
                f"3. **Compliance Tip:** Ensure alignment with your target SLA protocols to prevent client attrition."
        }
    }
    
    # Build response matrix based on overall score thresholds
    if score <= 25:
        return (
            f"🟢 **Profile Reputation Status: Excellent**\n\n"
            f"**RISK INDEX:** {score}/100 — Stable digital presence.\n\n"
            f"**RECOMMENDATION:** No protective intervention needed. Proceed with your standard online footprint strategy.\n\n"
            f"**INSIGHT:** Your profile displays healthy, clear sentiment markers across tracking nodes."
        )
    
    # Retrieve personalized playbook block based on profile type and primary category driver
    current_playbook = persona_advice.get(profile_type, persona_advice["business"])
    advice_text = current_playbook.get(primary_category, current_playbook.get("general", ""))
    
    if not advice_text:
        return (
            f"⚠️ **Elevated Risk: Active Monitoring Required**\n\n"
            f"**RISK INDEX:** {score}/100 — Attention required for {profile_type} classification.\n\n"
            f"**PRIMARY DRIVER:** {primary_category.replace('_', ' ').title()} ({primary_count} signals mapped).\n\n"
            f"**ACTION REQUIRED:** Dive into the tracking feed to audit individual high-severity records."
        )
        
    return advice_text


# ──────────────────────────────────────────────────────
# Get Entity
# ──────────────────────────────────────────────────────
def get_entity(entity_id: str):
    result = (
        supabase_admin
        .table("monitored_entities")
        .select("*")
        .eq("id", entity_id)
        .single()
        .execute()
    )
    return result.data


def _get_competitor_names(entity_id: str) -> list:
    """
    Returns the names of competitors linked to this entity. Best-effort:
    returns [] on any failure so recommendation generation never breaks.
    """
    try:
        links = (
            supabase_admin.table("competitor_links")
            .select("competitor_entity_id")
            .eq("primary_entity_id", entity_id)
            .execute()
        )
        comp_ids = [r["competitor_entity_id"] for r in (links.data or [])]
        if not comp_ids:
            return []
        comps = (
            supabase_admin.table("monitored_entities")
            .select("name")
            .in_("id", comp_ids)
            .execute()
        )
        return [c["name"] for c in (comps.data or []) if c.get("name")]
    except Exception as e:
        logging.warning("Could not load competitor names: %s", e)
        return []


# ──────────────────────────────────────────────────────
# Fetch Mentions (with joins)
# ──────────────────────────────────────────────────────
def fetch_mentions(entity_id: str):
    mentions = (
        supabase_admin
        .table("mentions")
        .select("*")
        .eq("entity_id", entity_id)
        .execute()
    ).data

    if not mentions:
        return []

    mention_lookup = {m["id"]: m for m in mentions}

    sentiment_rows = (
        supabase_admin
        .table("sentiment_results")
        .select("*")
        .in_("mention_id", list(mention_lookup.keys()))
        .execute()
    ).data

    merged = []

    for row in sentiment_rows:
        mention = mention_lookup.get(row["mention_id"])
        if not mention:
            continue

        merged.append({
            "label": row["label"],
            "severity": row["severity"],
            "confidence": row["confidence"],
            "category": row.get("category", "general"),
            "sub_category": row.get("sub_category", "general"),
            "risk_level": row.get("risk_level", "low"),
            "root_cause": row.get("root_cause", "No root cause identified"),
            "reason": row.get("reason", "No reason provided"),
            "source": _normalise_source(mention.get("source", "other")),
            "created_at": mention.get("created_at")
        })

    return merged


def _normalise_source(raw: str) -> str:
    mapping = {
        "google maps": "google_maps",
        "google reviews": "google_reviews",
        "nigerian news feed": "nigerian_news",
        "public forums (x/reddit)": "reddit",
        "twitter": "twitter",
        "facebook": "facebook",
        "linkedin": "linkedin",
        "nairaland": "nairaland",
        "vanguard": "vanguard",
        "guardian": "guardian",
        "thecable": "thecable",
        "punch": "punch",
        "premium times": "premium_times",
        "blog": "blog",
    }
    return mapping.get(raw.strip().lower(), "other")


# ──────────────────────────────────────────────────────
# Save Risk Score
# ──────────────────────────────────────────────────────
def save_risk_score(entity_id: str, score: dict):
    existing = (
        supabase_admin
        .table("risk_scores")
        .select("id")
        .eq("entity_id", entity_id)
        .execute()
    ).data

    payload = {
        "entity_id": entity_id,
        "score": score["score"],
        "status": score["status"],
        "negative_mentions": score["negative_mentions"],
        "positive_mentions": score["positive_mentions"],
        "neutral_mentions": score["neutral_mentions"],
        "category_breakdown": score.get("category_breakdown", {}),
        "root_cause_summary": score.get("root_cause_summary", "")
    }

    if existing:
        (
            supabase_admin
            .table("risk_scores")
            .update(payload)
            .eq("entity_id", entity_id)
            .execute()
        )
    else:
        (
            supabase_admin
            .table("risk_scores")
            .insert(payload)
            .execute()
        )


# ──────────────────────────────────────────────────────
# Send Email Alert
# ──────────────────────────────────────────────────────
def send_email(entity: dict, score: dict) -> bool:
    if score["score"] < EMAIL_ALERT_THRESHOLD:
        return False

    recipient = (
        entity.get("email")
        or os.getenv("ALERT_EMAIL_FALLBACK", "onboarding@resend.dev")
    )

    status_emoji = {
        "healthy": "✅",
        "watch": "👀",
        "elevated": "⚠️",
        "high": "🔶",
        "critical": "🚨",
    }.get(score["status"], "🔔")

    resend.Emails.send({
        "from": "SentiWatch <onboarding@resend.dev>",
        "to": recipient,
        "subject": (
            f"{status_emoji} Reputation Alert — "
            f"{entity['name']} scored {score['score']}/100"
        ),
        "html": f"""
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="color:#1A56DB;">SentiWatch Reputation Alert</h2>
          <p>
            <strong>{entity['name']}</strong> now has a reputation risk score of
            <strong style="font-size:1.2em;">{score['score']}/100</strong>.
          </p>
          <p>
            Status: <strong>{score['status'].upper()}</strong>
          </p>
          <p>Profile Context: <strong>{entity.get('profile_type', 'business').upper()}</strong></p>
          {f'<p><strong>Root Cause:</strong> {score.get("root_cause_summary", "N/A")}</p>' if score.get("root_cause_summary") else ''}
          <table style="border-collapse:collapse;width:100%;">
            <tr>
              <td style="padding:8px;border:1px solid #e5e7eb;">Negative mentions</td>
              <td style="padding:8px;border:1px solid #e5e7eb;color:#E02424;">
                {score['negative_mentions']}
              </td>
            </tr>
            <tr>
              <td style="padding:8px;border:1px solid #e5e7eb;">Positive mentions</td>
              <td style="padding:8px;border:1px solid #e5e7eb;color:#0E9F6E;">
                {score['positive_mentions']}
              </td>
            </tr>
            <tr>
              <td style="padding:8px;border:1px solid #e5e7eb;">Neutral mentions</td>
              <td style="padding:8px;border:1px solid #e5e7eb;color:#6B7280;">
                {score['neutral_mentions']}
              </td>
            </tr>
          </table>
          <p style="margin-top:24px;color:#6B7280;font-size:0.85em;">
            Log in to your SentiWatch dashboard for full analysis and recommendations.
          </p>
        </div>
        """
    })
    return True


# ──────────────────────────────────────────────────────
# Main Orchestrator
# Calls fetch_mentions() for joined mention+sentiment data,
# save_risk_score() (preserving mention counts), and send_email().
# ──────────────────────────────────────────────────────

def calculate_risk_and_alert(entity_id: str) -> dict:
    entity = get_entity(entity_id)
    if not entity:
        return {"error": "Entity not found"}

    # Extract the database profile type directly
    profile_type = entity.get("profile_type", "business")

    mentions = fetch_mentions(entity_id)
    metrics = calculate_entity_score(mentions)
    
    save_risk_score(entity_id, metrics)

    final_score = metrics["score"]
    brand_name = entity["name"]
    
    # Load competitor names to sharpen the AI recommendations.
    competitors = _get_competitor_names(entity_id)

    # Primary path: AI-generated, prioritized, discrete recommendations.
    ai_recs = generate_ai_recommendations(
        score=final_score,
        status=metrics["status"],
        category_breakdown=metrics.get("category_breakdown", {}),
        top_root_causes=metrics.get("top_root_causes", []),
        brand_name=brand_name,
        profile_type=profile_type,
        competitors=competitors,
    )

    if ai_recs:
        # Store the array as JSON in the existing action_plan column — no schema
        # migration needed. The frontend parses this into a ranked list.
        action_payload = json.dumps({"recommendations": ai_recs})
    else:
        # Safety net: the legacy template playbook as a single plain string.
        action_payload = generate_personalized_recommendation(
            score=final_score,
            status=metrics["status"],
            category_breakdown=metrics.get("category_breakdown", {}),
            top_root_causes=metrics.get("top_root_causes", []),
            brand_name=brand_name,
            profile_type=profile_type,
        )

    supabase_admin.table("recommendations").insert({
        "entity_id": entity_id,
        "risk_score": final_score,
        "trigger_category": metrics.get("primary_trigger_category", "general"),
        "action_plan": action_payload,
        "category_breakdown": metrics.get("category_breakdown", {}),
        "root_cause_summary": metrics.get("root_cause_summary", "")
    }).execute()

    alert_sent = send_email(entity, metrics)

    return {
        "entity": entity["name"],
        "profile_type": profile_type,
        "risk_score": final_score,
        "status": metrics["status"],
        "negative_mentions": metrics["negative_mentions"],
        "positive_mentions": metrics["positive_mentions"],
        "neutral_mentions": metrics["neutral_mentions"],
        "primary_trigger_category": metrics.get("primary_trigger_category", "general"),
        "root_cause_summary": metrics.get("root_cause_summary", ""),
        "category_breakdown": metrics.get("category_breakdown", {}),
        "recommendation_generated": True,
        "email_sent": alert_sent
    }