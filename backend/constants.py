"""
SentiWatch Global Constants

All reputation scoring weights live here.

Changing a value here automatically affects the
entire scoring engine.
"""

# ----------------------------------------------------
# Source credibility weights
# ----------------------------------------------------

SOURCE_WEIGHTS = {
    "google_reviews": 1.5,
    "google_maps": 1.5,

    "vanguard": 3.5,
    "guardian": 3.5,
    "thecable": 3.5,
    "punch": 3.5,
    "premium_times": 3.5,

    "nigerian_news": 2.5,

    "nairaland": 1.2,
    "reddit": 1.4,

    "facebook": 2.0,
    "twitter": 2.4,
    "linkedin": 2.5,

    "blog": 1.3,

    "other": 1.0,
}


# ----------------------------------------------------
# --- CATEGORY WEIGHTS (EDU) ---

CATEGORY_WEIGHTS = {
    "exams": 1.7,
    "portal_issues": 1.8,
    "lecturers": 1.5,
    "fees": 1.8,
    "hostels": 1.6,
    "admissions": 1.6,
    "scholarships": 1.7,
    "campus_life": 1.4,
    "general": 1.0,
}

# --- ALLOWED CATEGORIES (EDU) ---

ALLOWED_CATEGORIES = [
    "exams",
    "portal_issues",
    "lecturers",
    "fees",
    "hostels",
    "admissions",
    "scholarships",
    "campus_life",
]

# ----------------------------------------------------
# Risk multipliers
# ----------------------------------------------------

RISK_MULTIPLIERS = {
    "low": 1.0,
    "medium": 1.3,
    "high": 1.6,
    "critical": 2.0,
}


# ----------------------------------------------------
# Sentiment base values
# ----------------------------------------------------

SENTIMENT_VALUES = {
    "positive": -8,
    "neutral": 0,
    "negative": 10,
}


# ----------------------------------------------------
# Score band thresholds
# ----------------------------------------------------

LOW_THRESHOLD = 20
MEDIUM_THRESHOLD = 40
HIGH_THRESHOLD = 60
CRITICAL_THRESHOLD = 80


# ----------------------------------------------------
# Email alert threshold
# ----------------------------------------------------

EMAIL_ALERT_THRESHOLD = 60


# ----------------------------------------------------
# Maximum risk score cap
# ----------------------------------------------------

MAX_SCORE = 100


# ----------------------------------------------------
# Volume multipliers (keyed by negative mention count)
# ----------------------------------------------------

VOLUME_MULTIPLIERS = {
    1: 1.0,
    3: 1.15,
    5: 1.30,
    10: 1.60,
    20: 2.00,
}


# ----------------------------------------------------
# AI output validation sets
# ----------------------------------------------------

VALID_CATEGORIES = {
    "exams",
    "portal_issues",
    "lecturers",
    "fees",
    "hostels",
    "admissions",
    "scholarships",
    "campus_life",
    "general",
}

VALID_SENTIMENTS = {
    "positive",
    "neutral",
    "negative",
}

VALID_RISKS = {
    "low",
    "medium",
    "high",
    "critical",
}


# ----------------------------------------------------
# Category colors for dashboard heatmap
# ----------------------------------------------------

CATEGORY_COLORS = {
    "fraud": "#EF4444",
    "regulatory": "#F59E0B",
    "customer_complaint": "#F97316",
    "customer_praise": "#10B981",
    "product_quality": "#8B5CF6",
    "operations": "#3B82F6",
    "cyber": "#EC4899",
    "security": "#EF4444",
    "financial": "#F59E0B",
    "leadership": "#6366F1",
    "legal": "#8B5CF6",
    "general": "#6B7280",
}


# ----------------------------------------------------
# Industry mapping for personalized recommendations
# ----------------------------------------------------

INDUSTRY_MAPPING = {
    # Fintech
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
    "gtco": "fintech",
    "sterling": "fintech",
    "wema": "fintech",
    "fairmoney": "fintech",
    "carbon": "fintech",
    "mint": "fintech",
    "chipper": "fintech",
    "yellowcard": "fintech",
    "busha": "fintech",
    # Education
    "miva": "education",
    "ekiti state university": "education",
    "university of lagos": "education",
    "unilag": "education",
    "covenant university": "education",
    "bowen university": "education",
    # Hospitality
    "transcorp": "hospitality",
    "ecko hotel": "hospitality",
    "radisson": "hospitality",
    "sheraton": "hospitality",
    "four points": "hospitality",
    # E-commerce
    "jiji": "ecommerce",
    "konga": "ecommerce",
    "jumia": "ecommerce",
    "aliexpress": "ecommerce",
    "amazon": "ecommerce",
    # Transportation
    "gokada": "transportation",
    "bolt": "transportation",
    "uber": "transportation",
    "lagbus": "transportation",
    "max.ng": "transportation",
    "treepz": "transportation",
}