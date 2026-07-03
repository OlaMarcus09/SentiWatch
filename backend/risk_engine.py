import os

import resend

from dotenv import load_dotenv

from database import supabase, supabase_admin

from scoring import calculate_entity_score

from constants import EMAIL_ALERT_THRESHOLD

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")


# ──────────────────────────────────────────────────────
# Industry mapping for personalized recommendations
# ──────────────────────────────────────────────────────
INDUSTRY_MAPPING = {
    "cowrywise": "fintech",
    "opay": "fintech",
    "piggyvest": "fintech",
    "flutterwave": "fintech",
    "paystack": "fintech",
    "moniepoint": "fintech",
    "gtbank": "fintech",
    "access bank": "fintech",
    "first bank": "fintech",
    "kuda": "fintech",
    "miva": "education",
    "ekiti state university": "education",
    "university of lagos": "education",
    "transcorp": "hospitality",
    "ecko hotel": "hospitality",
    "jiji": "ecommerce",
    "konga": "ecommerce",
    "jumia": "ecommerce",
    "gokada": "transportation",
    "bolt": "transportation",
    "uber": "transportation",
}


def get_industry(brand_name: str) -> str:
    """Map a brand name to its industry."""
    if not brand_name:
        return "general"
    brand_lower = brand_name.lower().strip()
    for key, industry in INDUSTRY_MAPPING.items():
        if key in brand_lower:
            return industry
    return "general"


# ──────────────────────────────────────────────────────
# Personalized Recommendation Generator
# ──────────────────────────────────────────────────────
def generate_personalized_recommendation(
    score: int,
    status: str,
    category_breakdown: dict,
    top_root_causes: list,
    brand_name: str = "Your Brand",
    industry: str = "general"
) -> str:
    """
    Generates a personalized, actionable recommendation based on:
    - Risk score band
    - Category breakdown (what's driving the risk)
    - Root causes (specific triggers)
    - Brand industry (fintech, hospitality, etc.)
    """
    
    # Determine the primary category driver
    if not category_breakdown:
        primary_category = "general"
        primary_count = 0
    else:
        primary_category = max(category_breakdown, key=category_breakdown.get)
        primary_count = category_breakdown.get(primary_category, 0)
    
    # Category-specific advice by industry
    category_advice = {
        "fraud": {
            "fintech": "🔴 **Immediate Trust Protection Protocol**\n\n"
                f"**ROOT CAUSE:** {primary_count} fraud-related mentions detected. Customers are raising concerns about financial safety.\n\n"
                f"**ACTION PLAN (Fintech-Specific):**\n"
                f"1. **Immediate (2 hours):** Issue a formal statement on your verified social channels clarifying your fraud prevention measures.\n"
                f"2. **Within 4 hours:** Notify CBN compliance team and prepare a regulatory update.\n"
                f"3. **Within 24 hours:** Email all affected users with clear instructions on next steps.\n\n"
                f"**REMEMBER:** Fintechs face heightened regulatory scrutiny. Be transparent but avoid admitting liability without legal review.",
            
            "hospitality": "🔴 **Crisis Activation Mandate**\n\n"
                f"**ROOT CAUSE:** {primary_count} fraud-related mentions detected affecting guest trust.\n\n"
                f"**ACTION PLAN (Hospitality-Specific):**\n"
                f"1. **Immediate (2 hours):** Issue a statement clarifying your payment security measures.\n"
                f"2. **Within 24 hours:** Train front-desk staff on handling fraud concerns.\n"
                f"3. **Short-term (7 days):** Review your booking security protocols.",
            
            "general": "🔴 **CRISIS ACTIVATION: Fraud Allegation Detected**\n\n"
                f"**ROOT CAUSE:** {primary_count} fraud-related mentions detected.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Immediate (2 hours):** Draft a corporate clarification.\n"
                f"2. **Within 12 hours:** Consult legal counsel.\n"
                f"3. **Within 24 hours:** Issue public statement."
        },
        "customer_complaint": {
            "fintech": "🟠 **Operational Friction Triage**\n\n"
                f"**ROOT CAUSE:** {primary_count} customer complaints detected. Customers are frustrated with service issues.\n\n"
                f"**ACTION PLAN (Fintech-Specific):**\n"
                f"1. **Within 4 hours:** Identify the root cause from the complaints (fund lock-up, login issues, etc.).\n"
                f"2. **Within 8 hours:** Deploy a customer support team to personally respond to each complaint.\n"
                f"3. **Within 24 hours:** Issue a public acknowledgment and expected resolution timeline.\n\n"
                f"**⚠️ CBN Compliance Reminder:** Fintechs must respond to customer complaints within 4 hours by CBN guidelines.",
            
            "hospitality": "🟠 **Guest Experience Triage**\n\n"
                f"**ROOT CAUSE:** {primary_count} guest complaints detected about service quality.\n\n"
                f"**ACTION PLAN (Hospitality-Specific):**\n"
                f"1. **Within 4 hours:** Personally respond to each negative review.\n"
                f"2. **Within 24 hours:** Offer compensation (discount, free meal, etc.) to affected guests.\n"
                f"3. **Short-term (7 days):** Review service protocols based on complaint patterns.",
            
            "ecommerce": "🟠 **Customer Experience Triage**\n\n"
                f"**ROOT CAUSE:** {primary_count} customer complaints detected.\n\n"
                f"**ACTION PLAN (E-commerce-Specific):**\n"
                f"1. **Within 4 hours:** Respond to each complaint with empathy and a solution.\n"
                f"2. **Within 8 hours:** Identify if this is a recurring issue (delivery, quality, etc.).\n"
                f"3. **Within 24 hours:** Update your FAQ or policy page to address concerns.",
            
            "general": "🟠 **Customer Complaint Management**\n\n"
                f"**ROOT CAUSE:** {primary_count} customer complaints detected.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 8 hours:** Respond to each complaint personally.\n"
                f"2. **Within 24 hours:** Identify patterns and address root causes.\n"
                f"3. **Short-term:** Review your customer service protocols."
        },
        "regulatory": {
            "fintech": "🟠 **Regulatory Alignment Strategy**\n\n"
                f"**ROOT CAUSE:** {primary_count} regulatory mentions detected involving CBN, EFCC, or NAFDAC.\n\n"
                f"**ACTION PLAN (Fintech-Specific):**\n"
                f"1. **Immediate (2 hours):** Brief your legal/compliance team.\n"
                f"2. **Within 12 hours:** Prepare a factual statement verifying your regulatory standing.\n"
                f"3. **Within 24 hours:** If CBN is mentioned, contact your relationship manager proactively.\n\n"
                f"**⚠️ CRITICAL:** Never speculate on regulatory outcomes. Use only factual, verified information.",
            
            "general": "🟠 **Regulatory Compliance Review**\n\n"
                f"**ROOT CAUSE:** {primary_count} regulatory mentions detected.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 4 hours:** Engage your legal/compliance team.\n"
                f"2. **Within 12 hours:** Draft a factual holding statement.\n"
                f"3. **Within 24 hours:** Proactively contact relevant regulators."
        },
        "product_quality": {
            "fintech": "🟡 **Product Quality Assessment**\n\n"
                f"**ROOT CAUSE:** {primary_count} product quality complaints detected.\n\n"
                f"**ACTION PLAN (Fintech-Specific):**\n"
                f"1. **Within 8 hours:** Identify the specific product issue from complaints.\n"
                f"2. **Within 24 hours:** Deploy a fix or communicate the resolution timeline.\n"
                f"3. **Short-term:** Review QA processes for the product.",
            
            "general": "🟡 **Product Quality Review**\n\n"
                f"**ROOT CAUSE:** {primary_count} product quality complaints detected.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 12 hours:** Investigate the root cause.\n"
                f"2. **Within 24 hours:** Communicate the fix to affected customers.\n"
                f"3. **Short-term:** Implement quality control improvements."
        },
        "customer_praise": {
            "fintech": "🟢 **Maintaining Brand Equity**\n\n"
                f"**ROOT CAUSE:** {primary_count} customer praise mentions detected.\n\n"
                f"**ACTION PLAN (Fintech-Specific):**\n"
                f"1. **Within 4 hours:** Respond to and amplify the positive feedback.\n"
                f"2. **Within 24 hours:** Use testimonials in marketing materials.\n"
                f"3. **Short-term:** Identify if praise is tied to a specific feature → promote it.",
            
            "general": "🟢 **Brand Health — No Action Required**\n\n"
                f"**ROOT CAUSE:** {primary_count} positive mentions detected.\n\n"
                f"**ACTION PLAN:**\n"
                f"1. **Within 4 hours:** Respond to and amplify positive feedback.\n"
                f"2. **Short-term:** Use testimonials in marketing."
        }
    }
    
    # Build the recommendation
    if score <= 25:
        return (
            f"🟢 **Brand Health: Healthy**\n\n"
            f"**RISK SCORE:** {score}/100 — Brand sentiment is stable.\n\n"
            f"**ROOT CAUSE SUMMARY:** No significant negative mentions detected.\n\n"
            f"**RECOMMENDATION:** Continue monitoring. Maintain your current customer engagement strategy.\n\n"
            f"**PRO TIP:** Use your positive mentions ({sum(1 for c in category_breakdown.values() if c > 0)} positive signals) for organic marketing."
        )
    
    elif score <= 50:
        # Watch status — get the primary driver
        category_advice_text = category_advice.get(primary_category, {}).get(industry, category_advice.get(primary_category, {}).get("general", ""))
        
        if not category_advice_text:
            # Fallback generic advice
            return (
                f"👀 **Watch: Elevated Chatter Detected**\n\n"
                f"**RISK SCORE:** {score}/100 — Brand has elevated reputation chatter.\n\n"
                f"**ROOT CAUSE SUMMARY:** {len(category_breakdown)} categories of mentions detected.\n\n"
                f"**RECOMMENDATION:** Monitor closely and investigate root causes. Prepare a response plan.\n\n"
                f"**NEXT STEPS:** Check the mentions feed above to identify specific trigger topics."
            )
        
        return category_advice_text
    
    elif score <= 75:
        # Elevated — get the primary driver
        category_advice_text = category_advice.get(primary_category, {}).get(industry, category_advice.get(primary_category, {}).get("general", ""))
        
        if not category_advice_text:
            return (
                f"⚠️ **Elevated Risk: Active Management Required**\n\n"
                f"**RISK SCORE:** {score}/100 — Brand reputation is at risk.\n\n"
                f"**ROOT CAUSE SUMMARY:** {len(category_breakdown)} categories detected. Primary driver: {primary_category.replace('_', ' ').title()} ({primary_count} mentions).\n\n"
                f"**RECOMMENDATION:** Convene your communications team and develop a response strategy.\n\n"
                f"**NEXT STEPS:** Review the top negative mentions and prepare factual responses."
            )
        
        return category_advice_text
    
    else:
        # Critical
        category_advice_text = category_advice.get(primary_category, {}).get(industry, category_advice.get(primary_category, {}).get("general", ""))
        
        if not category_advice_text:
            return (
                f"🚨 **CRITICAL: Immediate Crisis Activation Mandate**\n\n"
                f"**RISK SCORE:** {score}/100 — BRAND IS IN CRISIS.\n\n"
                f"**ROOT CAUSE SUMMARY:** {primary_category.replace('_', ' ').title()} is the primary driver ({primary_count} mentions).\n\n"
                f"**RECOMMENDATION:**\n"
                f"1. **IMMEDIATE (30 min):** Convene a crisis war-room.\n"
                f"2. **Within 2 hours:** Retain a professional PR crisis management firm.\n"
                f"3. **Within 4 hours:** Issue a public statement acknowledging the issue.\n"
                f"4. **Ongoing:** Monitor SentiWatch every hour for sentiment changes.\n\n"
                f"**⚠️ WARNING:** Silence will amplify the narrative. Act decisively."
            )
        
        return category_advice_text


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
# ──────────────────────────────────────────────────────
def calculate_risk_and_alert(entity_id: str) -> dict:
    entity = get_entity(entity_id)
    if not entity:
        return {"error": "Entity not found"}

    mentions = fetch_mentions(entity_id)
    metrics = calculate_entity_score(mentions)
    
    save_risk_score(entity_id, metrics)

    final_score = metrics["score"]
    
    # Generate personalized recommendation
    brand_name = entity["name"]
    industry = get_industry(brand_name)
    
    action_text = generate_personalized_recommendation(
        score=final_score,
        status=metrics["status"],
        category_breakdown=metrics.get("category_breakdown", {}),
        top_root_causes=metrics.get("top_root_causes", []),
        brand_name=brand_name,
        industry=industry
    )

    supabase_admin.table("recommendations").insert({
        "entity_id": entity_id,
        "risk_score": final_score,
        "trigger_category": metrics.get("primary_trigger_category", "general"),
        "action_plan": action_text,
        "category_breakdown": metrics.get("category_breakdown", {}),
        "root_cause_summary": metrics.get("root_cause_summary", "")
    }).execute()

    alert_sent = send_email(entity, metrics)

    return {
        "entity": entity["name"],
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