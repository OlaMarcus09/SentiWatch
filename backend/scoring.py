"""
SentiWatch Reputation Scoring Engine

This module converts AI sentiment results into a
real reputation risk score.

The score is based on:

- sentiment (signed: positive reduces risk, negative increases)
- severity
- confidence
- source credibility
- category
- AI risk level
- recency
- mention volume

Final score is normalized to 0–100.
"""

from datetime import datetime, timezone
from math import exp
from collections import Counter

from constants import (
    SOURCE_WEIGHTS,
    CATEGORY_WEIGHTS,
    RISK_MULTIPLIERS,
    SENTIMENT_VALUES,
    VOLUME_MULTIPLIERS,
    MAX_SCORE,
)


# -----------------------------------------------------
# Source Weight
# -----------------------------------------------------

def source_weight(source: str) -> float:
    if not source:
        return SOURCE_WEIGHTS["other"]

    return SOURCE_WEIGHTS.get(
        source.strip().lower(),
        SOURCE_WEIGHTS["other"]
    )


# -----------------------------------------------------
# Category Weight
# -----------------------------------------------------

def category_weight(category: str) -> float:
    if not category:
        return CATEGORY_WEIGHTS["general"]

    return CATEGORY_WEIGHTS.get(
        category.strip().lower(),
        CATEGORY_WEIGHTS["general"]
    )


# -----------------------------------------------------
# Risk Multiplier
# -----------------------------------------------------

def risk_multiplier(risk: str) -> float:

    if not risk:
        return 1.0

    return RISK_MULTIPLIERS.get(
        risk.lower(),
        1.0
    )


# -----------------------------------------------------
# Confidence Weight
# -----------------------------------------------------

def confidence_weight(confidence):

    try:

        confidence = float(confidence)

    except (ValueError, TypeError):

        confidence = 0.75

    confidence = max(0.50, confidence)

    confidence = min(confidence, 1.0)

    return confidence


# -----------------------------------------------------
# Severity Weight
# -----------------------------------------------------

def severity_weight(severity):

    try:

        severity = int(severity)

    except (ValueError, TypeError):

        severity = 5

    severity = max(1, severity)

    severity = min(10, severity)

    return severity


# -----------------------------------------------------
# Recency Weight
# -----------------------------------------------------

def recency_weight(created_at):

    """
    Exponential decay.

    Today    = 1.0
    30 days  ≈ 0.60
    90 days  ≈ 0.22
    """

    if not created_at:
        return 1

    try:
        created = datetime.fromisoformat(
            created_at.replace("Z", "+00:00")
        )
    except (ValueError, TypeError, AttributeError):
        return 1

    now = datetime.now(timezone.utc)
    age = (now - created).days
    decay = exp(-age / 60)

    return max(0.20, decay)


# -----------------------------------------------------
# Volume Multiplier
# -----------------------------------------------------

def volume_multiplier(count):

    count = max(count, 1)

    multiplier = 1

    for threshold in sorted(VOLUME_MULTIPLIERS):

        if count >= threshold:

            multiplier = VOLUME_MULTIPLIERS[threshold]

    return multiplier


# -----------------------------------------------------
# Mention Score
# 🔥 FIXED: Removed abs() — positive now REDUCES risk!
# -----------------------------------------------------

def mention_score(

    sentiment,

    severity,

    confidence,

    source,

    category,

    risk,

    created_at=None

):

    sentiment_value = SENTIMENT_VALUES.get(
        sentiment.lower(),
        0
    )

    if sentiment_value == 0:
        return 0

    # ✅ CORRECT: Keep the sign — positive reduces risk, negative increases
    score = sentiment_value  # Was: abs(sentiment_value) — THIS WAS THE BUG!

    score *= severity_weight(severity)

    score *= confidence_weight(confidence)

    score *= source_weight(source)

    score *= category_weight(category)

    score *= risk_multiplier(risk)

    score *= recency_weight(created_at)

    return score


# -----------------------------------------------------
# Normalize
# -----------------------------------------------------

def normalize(score):

    """
    Converts raw score into 0–100
    """

    normalized = round(score)

    normalized = max(0, normalized)

    normalized = min(MAX_SCORE, normalized)

    return normalized


# -----------------------------------------------------
# Status
# -----------------------------------------------------

def score_status(score):

    if score < 20:

        return "healthy"

    if score < 40:

        return "watch"

    if score < 60:

        return "elevated"

    if score < 80:

        return "high"

    return "critical"


# -----------------------------------------------------
# Final Entity Score (with root cause analysis)
# -----------------------------------------------------

def calculate_entity_score(mentions):
    """
    Calculates final risk metrics and isolates the primary driver of reputation risk.
    Also returns a breakdown by category for the dashboard heatmap.
    """
    if not mentions:
        return {
            "score": 0,
            "status": "healthy",
            "negative_mentions": 0,
            "positive_mentions": 0,
            "neutral_mentions": 0,
            "primary_trigger_category": "general",
            "category_breakdown": {},
            "root_cause_summary": "No data available."
        }

    raw_score = 0
    negatives = 0
    positives = 0
    neutrals = 0
    
    # Track category breakdown for heatmap
    category_breakdown = {}
    category_severity = {}
    root_causes = []
    
    # Track highest severity category
    highest_severity = -1
    primary_trigger_category = "general"
    primary_root_cause = ""

    for mention in mentions:
        sentiment = mention.get("label", "neutral")
        category = mention.get("category", "general").strip().lower()
        severity = int(mention.get("severity", 5))
        risk_level = mention.get("risk_level", "low")
        root_cause = mention.get("reason", "No specific cause identified")

        if sentiment == "negative":
            negatives += 1
            
            # Track category breakdown
            category_breakdown[category] = category_breakdown.get(category, 0) + 1
            category_severity[category] = max(category_severity.get(category, 0), severity)
            
            # Track root causes
            if severity >= 7:  # Only track high-severity root causes
                root_causes.append({
                    "category": category,
                    "severity": severity,
                    "cause": root_cause
                })
            
            # Track primary trigger
            if severity > highest_severity:
                highest_severity = severity
                primary_trigger_category = category
                primary_root_cause = root_cause
                
        elif sentiment == "positive":
            positives += 1
        else:
            neutrals += 1

        raw_score += mention_score(
            sentiment=sentiment,
            severity=severity,
            confidence=mention.get("confidence", 0.8),
            source=mention.get("source", "other"),
            category=category,
            risk=risk_level,
            created_at=mention.get("created_at")
        )

    raw_score *= volume_multiplier(negatives)
    final_score = normalize(raw_score)

    # Build root cause summary
    if negatives == 0:
        root_cause_summary = "No negative mentions detected. Brand reputation is healthy."
    elif root_causes:
        # Sort root causes by severity (highest first)
        root_causes.sort(key=lambda x: x["severity"], reverse=True)
        top_causes = root_causes[:3]
        cause_strs = [f"{c['category'].replace('_', ' ').title()}: {c['cause']}" for c in top_causes]
        root_cause_summary = f"Top drivers: " + "; ".join(cause_strs)
    else:
        root_cause_summary = f"Primary trigger: {primary_trigger_category.replace('_', ' ').title()} — {primary_root_cause}"

    return {
        "score": final_score,
        "status": score_status(final_score),
        "negative_mentions": negatives,
        "positive_mentions": positives,
        "neutral_mentions": neutrals,
        "primary_trigger_category": primary_trigger_category,
        "category_breakdown": category_breakdown,
        "root_cause_summary": root_cause_summary,
        "top_root_causes": root_causes[:3]
    }