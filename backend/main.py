from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends, Request
from services.search_service import fetch_entity_context
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from collections import Counter, defaultdict, deque
from threading import Lock
import os
import asyncio
import secrets
import uuid
import logging
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client

from database import supabase, supabase_admin
from scrapers import (
    scrape_nigerian_news,
    fetch_google_reviews,
    scrape_social_media,
    scrape_youtube,
    scrape_twitter,
    scrape_facebook,
)
from sentiment import analyze_and_store_sentiment, reprocess_existing_sentiment
from risk_engine import calculate_risk_and_alert, send_daily_digests

# PIVOT TODO: Import your new search service here once you create the file
# from services.search_service import fetch_entity_context

# =========================================================
# APP INITIALIZATION
# =========================================================

app = FastAPI(title="SentiWatch API - SaaS Version")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,https://senti-watch.vercel.app",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response

# =========================================================
# REQUEST MODELS
# =========================================================

class BrandCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # New Pivot Fields
    profile_type: str = "business"  # e.g., student, influencer, business, real_estate
    social_handle: Optional[str] = Field(default=None, max_length=120)  # e.g., @gtbank
    competitors: List[str] = Field(default_factory=list, max_length=3)


class CompetitorAddRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class EntityUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    profile_type: Optional[str] = None
    social_handle: Optional[str] = Field(default=None, max_length=120)


class NotificationPreferencesRequest(BaseModel):
    email_alerts_enabled: bool = True
    daily_digest_enabled: bool = False


class RecommendationDismissRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)


VALID_PROFILE_TYPES = {"business", "influencer", "student", "real_estate"}
MAX_ENTITIES_PER_USER = max(1, int(os.getenv("MAX_ENTITIES_PER_USER", "10")))
MAX_COMPETITORS_PER_ENTITY = max(1, int(os.getenv("MAX_COMPETITORS_PER_ENTITY", "3")))
USER_MUTATION_LIMIT_PER_MINUTE = max(1, int(os.getenv("USER_MUTATION_LIMIT_PER_MINUTE", "10")))
_mutation_windows = defaultdict(deque)
_mutation_lock = Lock()
_pipeline_schedule_lock = Lock()

# =========================================================
# AUTH DEPENDENCIES
# =========================================================

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")


def verify_internal_key(x_internal_key: str | None = Header(None)):
    """
    Guards machine-to-machine endpoints (cron / internal jobs).
    Requires the X-Internal-Key header to match INTERNAL_API_KEY.
    Fails closed if the server key is not configured.
    """
    if not INTERNAL_API_KEY:
        # Misconfiguration: never allow open access as a fallback.
        raise HTTPException(status_code=503, detail="Internal API not configured")
    if not x_internal_key or not secrets.compare_digest(x_internal_key, INTERNAL_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing internal key")


def verify_user(authorization: str | None = Header(None)):
    """
    Verifies a Supabase user JWT and returns the authenticated user.
    Raises 401 on any failure. Reusable across user-facing routes.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    token = token.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid Authorization header")

    try:
        auth_response = supabase_admin.auth.get_user(token)
        user = getattr(auth_response, "user", None)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logging.error("AUTH ERROR: %s", str(e))
        raise HTTPException(status_code=401, detail="Authentication failed")


def enforce_user_mutation_limit(user = Depends(verify_user)):
    """Small single-instance guard against accidental or abusive provider spend."""
    now = datetime.now(timezone.utc).timestamp()
    with _mutation_lock:
        window = _mutation_windows[str(user.id)]
        while window and window[0] <= now - 60:
            window.popleft()
        if len(window) >= USER_MUTATION_LIMIT_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Too many requests. Try again shortly.")
        window.append(now)
    return user


def _require_entity(entity_id: str) -> dict:
    """Resolve pipeline inputs from the database instead of trusting callers."""
    try:
        result = (
            supabase_admin.table("monitored_entities")
            .select("id, name, profile_type, social_handle, user_id")
            .eq("id", entity_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logging.error("Entity lookup failed for %s: %s", entity_id, exc)
        raise HTTPException(status_code=500, detail="Could not look up entity") from exc
    if not result.data:
        raise HTTPException(status_code=404, detail="Entity not found")
    return result.data


def _require_owned_entity(entity_id: str, user_id: str) -> dict:
    entity = _require_entity(entity_id)
    if str(entity.get("user_id")) != str(user_id):
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity


def _get_active_pipeline_run(entity_id: str) -> dict | None:
    """Return the entity's newest unexpired pipeline lease, if one exists."""
    try:
        result = (
            supabase_admin.table("pipeline_runs")
            .select("id, status, stage, started_at, updated_at, lease_expires_at")
            .eq("entity_id", entity_id)
            .eq("status", "running")
            .gt("lease_expires_at", datetime.now(timezone.utc).isoformat())
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logging.error("Active pipeline lookup failed for %s: %s", entity_id, exc)
        raise HTTPException(status_code=500, detail="Could not verify analysis status") from exc
    return (result.data or [None])[0]


COMPETITIVE_WINDOWS = {7, 30, 90}


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _pct(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def _build_competitive_intelligence(
    primary_entity_id: str,
    entities: list[dict],
    mentions: list[dict],
    sentiments: list[dict],
    risk_snapshots: list[dict],
    window_days: int,
    period_start: datetime,
    period_end: datetime,
) -> dict:
    """Build comparison metrics from bounded database rows."""
    entity_ids = [str(entity["id"]) for entity in entities]
    sentiment_by_mention = {
        str(row["mention_id"]): row for row in sentiments if row.get("mention_id")
    }
    mentions_by_entity = defaultdict(list)
    for mention in mentions:
        entity_key = str(mention.get("entity_id"))
        if entity_key in entity_ids:
            mentions_by_entity[entity_key].append(mention)

    risk_by_entity = defaultdict(list)
    for snapshot in risk_snapshots:
        entity_key = str(snapshot.get("entity_id"))
        if entity_key in entity_ids:
            risk_by_entity[entity_key].append(snapshot)
    for snapshots in risk_by_entity.values():
        snapshots.sort(key=lambda row: _parse_utc(row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))

    entity_counts = {}
    total_volume = total_positive = total_negative = 0
    for entity_id in entity_ids:
        rows = mentions_by_entity[entity_id]
        usable = [row for row in rows if row.get("status") != "rejected"]
        labels = [
            sentiment_by_mention[str(row["id"])].get("label", "neutral")
            for row in usable if str(row.get("id")) in sentiment_by_mention
        ]
        counts = Counter(labels)
        entity_counts[entity_id] = (rows, usable, counts)
        total_volume += len(usable)
        total_positive += counts["positive"]
        total_negative += counts["negative"]

    comparisons = []
    for entity in entities:
        entity_id = str(entity["id"])
        all_rows, usable_rows, sentiment_counts = entity_counts[entity_id]
        analyzed_count = sum(sentiment_counts.values())
        pending_count = len(usable_rows) - analyzed_count

        source_counts = Counter(
            (row.get("platform") or row.get("source") or "unknown").strip().lower()
            for row in usable_rows
        )
        category_counts = Counter()
        daily = defaultdict(lambda: Counter({
            "mentions": 0, "positive": 0, "neutral": 0, "negative": 0,
        }))
        for row in usable_rows:
            created_at = _parse_utc(row.get("created_at"))
            day = created_at.date().isoformat() if created_at else "unknown"
            daily[day]["mentions"] += 1
            sentiment = sentiment_by_mention.get(str(row.get("id")))
            if not sentiment:
                continue
            label = sentiment.get("label")
            if label in {"positive", "neutral", "negative"}:
                daily[day][label] += 1
            if label == "negative":
                category_counts[sentiment.get("category") or "general"] += 1

        snapshots = risk_by_entity[entity_id]
        in_window_snapshots = [
            row for row in snapshots
            if (created_at := _parse_utc(row.get("created_at")))
            and period_start <= created_at <= period_end
        ]
        current = snapshots[-1] if snapshots else None
        baseline = in_window_snapshots[0] if in_window_snapshots else current
        delta = (
            current.get("score", 0) - baseline.get("score", 0)
            if current and baseline else None
        )
        mention_base_filter = {
            "entity_id": entity_id,
            "created_at_gte": period_start.isoformat(),
            "created_at_lte": period_end.isoformat(),
            "exclude_status": "rejected",
        }
        risk_by_day = {}
        for snapshot in in_window_snapshots:
            snapshot_at = _parse_utc(snapshot.get("created_at"))
            if snapshot_at:
                risk_by_day[snapshot_at.date().isoformat()] = snapshot.get("score")
        trend_days = sorted(set(daily) | set(risk_by_day))

        comparisons.append({
            "id": entity_id,
            "name": entity.get("name"),
            "is_primary": entity_id == str(primary_entity_id),
            "evidence_status": (
                "no_evidence" if not usable_rows else
                "partial" if pending_count else "verified"
            ),
            "coverage_pct": _pct(analyzed_count, len(usable_rows)),
            "counts": {
                "mentions": len(usable_rows),
                "analyzed": analyzed_count,
                "pending": pending_count,
                "positive": sentiment_counts["positive"],
                "neutral": sentiment_counts["neutral"],
                "negative": sentiment_counts["negative"],
            },
            "shares": {
                "voice": _pct(len(usable_rows), total_volume),
                "positive": _pct(sentiment_counts["positive"], total_positive),
                "negative": _pct(sentiment_counts["negative"], total_negative),
            },
            "latest_risk": ({
                "score": current.get("score"),
                "status": current.get("status"),
                "created_at": current.get("created_at"),
            } if current else None),
            "risk_delta": delta,
            "source_distribution": [
                {
                    "source": source,
                    "count": count,
                    "share": _pct(count, len(usable_rows)),
                    "filters": {**mention_base_filter, "source": source},
                }
                for source, count in source_counts.most_common()
            ],
            "top_categories": [
                {
                    "category": category,
                    "count": count,
                    "share": _pct(count, sentiment_counts["negative"]),
                    "filters": {
                        **mention_base_filter,
                        "sentiment": "negative",
                        "category": category,
                    },
                }
                for category, count in category_counts.most_common(5)
            ],
            "trend": [
                {
                    "date": day,
                    "mentions": daily[day]["mentions"],
                    "positive": daily[day]["positive"],
                    "neutral": daily[day]["neutral"],
                    "negative": daily[day]["negative"],
                    "risk_score": risk_by_day.get(day),
                }
                for day in trend_days
            ],
            "filters": {
                "voice": mention_base_filter,
                "positive": {**mention_base_filter, "sentiment": "positive"},
                "neutral": {**mention_base_filter, "sentiment": "neutral"},
                "negative": {**mention_base_filter, "sentiment": "negative"},
            },
        })

    return {
        "window_days": window_days,
        "from": period_start.isoformat(),
        "to": period_end.isoformat(),
        "total_mentions": total_volume,
        "entities": comparisons,
    }

# =========================================================
# HEALTH CHECKS
# =========================================================

@app.get("/")
def read_root():
    return {"status": "SentiWatch API is live and running."}

@app.get("/health/db")
def check_db_connection():
    try:
        supabase.table("monitored_entities").select("id").limit(1).execute()
        return {"database_status": "Connected to Supabase successfully", "error": None}
    except Exception as e:
        logging.error("Database health check failed: %s", e)
        raise HTTPException(status_code=503, detail="Database unavailable")


@app.get("/health/ready")
def readiness_check():
    missing = [
        key for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE", "INTERNAL_API_KEY")
        if not os.getenv(key)
    ]
    if not (os.getenv("GROQ_API_KEY") or (
        os.getenv("AGENTROUTER_BASE_URL") and os.getenv("AGENTROUTER_API_KEY")
    )):
        missing.append("LLM_PROVIDER")
    if missing:
        raise HTTPException(status_code=503, detail="Service configuration incomplete")
    try:
        supabase_admin.table("monitored_entities").select("id").limit(1).execute()
    except Exception as exc:
        logging.error("Readiness database check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ready"}


@app.get("/notification-preferences")
def get_notification_preferences(user = Depends(verify_user)):
    try:
        result = (
            supabase_admin.table("notification_preferences")
            .select("email_alerts_enabled, daily_digest_enabled")
            .eq("user_id", user.id)
            .maybe_single()
            .execute()
        )
        preferences = getattr(result, "data", None) or {
            "email_alerts_enabled": True,
            "daily_digest_enabled": False,
        }
        return {**preferences, "daily_digest_available": True}
    except Exception as e:
        logging.error("Notification preferences lookup failed for %s: %s", user.id, e)
        raise HTTPException(status_code=500, detail="Could not load notification preferences")


@app.get("/entities/{entity_id}/trust")
def get_entity_trust_summary(entity_id: str, user = Depends(verify_user)):
    """Return complete evidence coverage and pipeline health for one entity."""
    _require_owned_entity(entity_id, user.id)
    try:
        mention_rows = (
            supabase_admin.table("mentions")
            .select("id, status, source, platform, created_at, published_at")
            .eq("entity_id", entity_id)
            .order("created_at", desc=True)
            .limit(5000)
            .execute()
        ).data or []

        mention_ids = [row["id"] for row in mention_rows]
        analyzed_ids = set()
        for offset in range(0, len(mention_ids), 200):
            batch = mention_ids[offset:offset + 200]
            if not batch:
                continue
            rows = (
                supabase_admin.table("sentiment_results")
                .select("mention_id")
                .in_("mention_id", batch)
                .execute()
            ).data or []
            analyzed_ids.update(row["mention_id"] for row in rows)

        rejected_ids = {
            row["id"] for row in mention_rows if row.get("status") == "rejected"
        }
        inconsistent_ids = {
            row["id"] for row in mention_rows
            if row.get("status") == "processed" and row["id"] not in analyzed_ids
        }
        pending_ids = {
            row["id"] for row in mention_rows
            if row["id"] not in analyzed_ids and row["id"] not in rejected_ids
        }

        source_map = {}
        for row in mention_rows:
            key = row.get("platform") or row.get("source") or "unknown"
            item = source_map.setdefault(key, {
                "source": key,
                "collected": 0,
                "analyzed": 0,
                "pending": 0,
                "latest_at": None,
            })
            item["collected"] += 1
            if row["id"] in analyzed_ids:
                item["analyzed"] += 1
            elif row["id"] not in rejected_ids:
                item["pending"] += 1
            # Source freshness measures when SentiWatch most recently received
            # evidence. An old article collected today still proves the
            # connector is active, even though its publication date is old.
            evidence_at = row.get("created_at")
            if evidence_at and (not item["latest_at"] or evidence_at > item["latest_at"]):
                item["latest_at"] = evidence_at

        now = datetime.now(timezone.utc)

        def add_freshness(item):
            latest_at = item.get("latest_at")
            if not latest_at:
                return {**item, "freshness_status": "no_data", "age_hours": None}
            try:
                latest_evidence = datetime.fromisoformat(
                    str(latest_at).replace("Z", "+00:00")
                )
                if latest_evidence.tzinfo is None:
                    latest_evidence = latest_evidence.replace(tzinfo=timezone.utc)
                age_hours = max(0, round((now - latest_evidence).total_seconds() / 3600))
            except (TypeError, ValueError):
                return {**item, "freshness_status": "no_data", "age_hours": None}

            if age_hours <= 24:
                freshness_status = "fresh"
            elif age_hours <= 72:
                freshness_status = "aging"
            else:
                freshness_status = "stale"
            return {
                **item,
                "freshness_status": freshness_status,
                "age_hours": age_hours,
            }

        sources = [add_freshness(item) for item in source_map.values()]
        freshest_source = min(
            (source for source in sources if source["age_hours"] is not None),
            key=lambda source: source["age_hours"],
            default=None,
        )
        stale_sources = sum(
            source["freshness_status"] == "stale" for source in sources
        )
        if not sources or not freshest_source:
            freshness_status = "no_data"
        elif stale_sources == len(sources):
            freshness_status = "stale"
        elif stale_sources:
            freshness_status = "mixed"
        elif any(source["freshness_status"] == "aging" for source in sources):
            freshness_status = "aging"
        else:
            freshness_status = "fresh"

        latest_runs = (
            supabase_admin.table("pipeline_runs")
            .select("status, stage, error_message, started_at, finished_at")
            .eq("entity_id", entity_id)
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        latest_run = latest_runs[0] if latest_runs else None

        total = len(mention_rows)
        analyzed = len(analyzed_ids - rejected_ids)
        pending = len(pending_ids)
        rejected = len(rejected_ids)
        inconsistent = len(inconsistent_ids)
        if total == 0:
            coverage_status = "no_evidence"
        elif latest_run and latest_run.get("status") == "failed":
            coverage_status = "degraded"
        elif pending or inconsistent:
            coverage_status = "partial"
        else:
            coverage_status = "verified"

        return {
            "entity_id": entity_id,
            "coverage_status": coverage_status,
            "coverage_pct": min(100, round((analyzed / max(1, total - rejected)) * 100)),
            "counts": {
                "collected": total,
                "analyzed": analyzed,
                "pending": pending,
                "rejected": rejected,
                "inconsistent": inconsistent,
            },
            "latest_pipeline": latest_run,
            "freshness": {
                "status": freshness_status,
                "latest_at": freshest_source["latest_at"] if freshest_source else None,
                "stale_sources": stale_sources,
                "total_sources": len(sources),
            },
            "sources": sorted(
                sources, key=lambda item: item["collected"], reverse=True
            ),
            "truncated": total >= 5000,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logging.error("Trust summary failed for %s: %s", entity_id, exc)
        raise HTTPException(status_code=500, detail="Could not load data trust summary")


@app.get("/entities/{entity_id}/competitive-intelligence")
def get_competitive_intelligence(
    entity_id: str,
    window: int = 30,
    user = Depends(verify_user),
):
    """Compare a primary entity with its linked competitors over 7/30/90 days."""
    if window not in COMPETITIVE_WINDOWS:
        raise HTTPException(status_code=400, detail="window must be 7, 30, or 90")

    primary = _require_owned_entity(entity_id, user.id)
    period_end = datetime.now(timezone.utc)
    period_start = period_end - timedelta(days=window)
    try:
        links = (
            supabase_admin.table("competitor_links")
            .select("competitor_entity_id")
            .eq("primary_entity_id", entity_id)
            .execute()
        ).data or []
        competitor_ids = [
            str(row["competitor_entity_id"])
            for row in links if row.get("competitor_entity_id")
        ]
        competitors = []
        if competitor_ids:
            competitors = (
                supabase_admin.table("monitored_entities")
                .select("id, name, user_id")
                .in_("id", competitor_ids)
                .eq("user_id", user.id)
                .execute()
            ).data or []
        entities = [
            {"id": primary["id"], "name": primary.get("name"), "user_id": primary.get("user_id")},
            *competitors,
        ]
        entity_ids = [str(entity["id"]) for entity in entities]

        mentions = (
            supabase_admin.table("mentions")
            .select("id, entity_id, source, platform, status, created_at")
            .in_("entity_id", entity_ids)
            .gte("created_at", period_start.isoformat())
            .lte("created_at", period_end.isoformat())
            .order("created_at", desc=True)
            .limit(10000)
            .execute()
        ).data or []
        mention_ids = [str(row["id"]) for row in mentions if row.get("id")]
        sentiments = []
        for offset in range(0, len(mention_ids), 200):
            batch = mention_ids[offset:offset + 200]
            rows = (
                supabase_admin.table("sentiment_results")
                .select("mention_id, label, category")
                .in_("mention_id", batch)
                .execute()
            ).data or []
            sentiments.extend(rows)

        risk_snapshots = (
            supabase_admin.table("risk_scores")
            .select("entity_id, score, status, created_at")
            .in_("entity_id", entity_ids)
            .gte("created_at", period_start.isoformat())
            .lte("created_at", period_end.isoformat())
            .order("created_at", desc=True)
            .limit(5000)
            .execute()
        ).data or []

        response = _build_competitive_intelligence(
            primary_entity_id=entity_id,
            entities=entities,
            mentions=mentions,
            sentiments=sentiments,
            risk_snapshots=risk_snapshots,
            window_days=window,
            period_start=period_start,
            period_end=period_end,
        )
        response["truncated"] = {
            "mentions": len(mentions) >= 10000,
            "risk_snapshots": len(risk_snapshots) >= 5000,
        }
        return response
    except HTTPException:
        raise
    except Exception as exc:
        logging.error("Competitive intelligence failed for %s: %s", entity_id, exc)
        raise HTTPException(status_code=500, detail="Could not load competitive intelligence")


@app.put("/notification-preferences")
def update_notification_preferences(
    payload: NotificationPreferencesRequest,
    user = Depends(verify_user),
):
    preferences = {
        "user_id": user.id,
        "email_alerts_enabled": payload.email_alerts_enabled,
        "daily_digest_enabled": payload.daily_digest_enabled,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = (
            supabase_admin.table("notification_preferences")
            .upsert(preferences, on_conflict="user_id")
            .execute()
        )
    except Exception as e:
        logging.error("Notification preferences update failed for %s: %s", user.id, e)
        raise HTTPException(status_code=500, detail="Could not update notification preferences")
    saved = getattr(result, "data", [])
    result_preferences = saved[0] if saved else preferences
    return {**result_preferences, "daily_digest_available": True}


@app.get("/notifications")
def list_notifications(limit: int = 30, unread_only: bool = False, user = Depends(verify_user)):
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 100")
    try:
        query = (supabase_admin.table("notifications").select("*")
                 .eq("user_id", user.id).order("created_at", desc=True).limit(limit))
        if unread_only:
            query = query.eq("is_read", False)
        return {"notifications": query.execute().data or []}
    except Exception as exc:
        logging.error("Notification list failed for %s: %s", user.id, exc)
        raise HTTPException(status_code=500, detail="Could not load notifications")


@app.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, user = Depends(verify_user)):
    try:
        result = (supabase_admin.table("notifications")
                  .update({"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()})
                  .eq("id", notification_id).eq("user_id", user.id).execute())
        if not result.data:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"success": True, "notification": result.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logging.error("Notification read failed for %s: %s", notification_id, exc)
        raise HTTPException(status_code=500, detail="Could not update notification")


@app.post("/notifications/read-all")
def mark_all_notifications_read(user = Depends(verify_user)):
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (supabase_admin.table("notifications")
                  .update({"is_read": True, "read_at": now})
                  .eq("user_id", user.id).eq("is_read", False).execute())
        return {"success": True, "updated": len(result.data or [])}
    except Exception as exc:
        logging.error("Notification read-all failed for %s: %s", user.id, exc)
        raise HTTPException(status_code=500, detail="Could not update notifications")


@app.post("/internal/send-daily-digests", dependencies=[Depends(verify_internal_key)])
def trigger_daily_digests():
    return send_daily_digests()

# =========================================================
# BACKGROUND WORKER
# =========================================================

# 1. Change to `async def` to support the Tavily await call
PIPELINE_LEASE_SECONDS = int(os.getenv("PIPELINE_LEASE_SECONDS", "900"))


def _record_pipeline_run(
    entity_id: str,
    status: str,
    stage: str,
    error: str | None = None,
    *,
    run_id: str | None = None,
    brand_name: str | None = None,
    profile_type: str | None = None,
    social_handle: str | None = None,
    worker_token: str | None = None,
):
    """Persist background progress when the pipeline_runs migration is present."""
    payload = {
        "entity_id": entity_id,
        "status": status,
        "stage": stage,
        "error_message": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if status == "running" and stage == "starting":
        payload["started_at"] = payload["updated_at"]
        payload.update({
            "brand_name": brand_name,
            "profile_type": profile_type,
            "social_handle": social_handle,
            "worker_token": worker_token,
            "lease_expires_at": (
                datetime.now(timezone.utc) + timedelta(seconds=PIPELINE_LEASE_SECONDS)
            ).isoformat(),
        })
    elif status == "running":
        payload["lease_expires_at"] = (
            datetime.now(timezone.utc) + timedelta(seconds=PIPELINE_LEASE_SECONDS)
        ).isoformat()
    if status in {"completed", "failed"}:
        payload["finished_at"] = payload["updated_at"]
        payload["lease_expires_at"] = None

    try:
        if status == "running" and stage == "starting":
            result = supabase_admin.table("pipeline_runs").insert(payload).execute()
            return result.data[0]["id"] if result.data else None

        existing = ({"data": [{"id": run_id}]} if run_id else
            supabase_admin.table("pipeline_runs")
            .select("id")
            .eq("entity_id", entity_id)
            .eq("status", "running")
            .order("started_at", desc=True)
            .limit(1)
            .execute())
        existing_data = existing["data"] if isinstance(existing, dict) else existing.data
        if existing_data:
            (
                (supabase_admin.table("pipeline_runs")
                 .update(payload)
                 .eq("id", existing_data[0]["id"])
                 .eq("worker_token", worker_token))
                if worker_token else
                (supabase_admin.table("pipeline_runs")
                 .update(payload)
                 .eq("id", existing_data[0]["id"]))
            ).execute()
        else:
            supabase_admin.table("pipeline_runs").insert(payload).execute()
    except Exception as e:
        # Deploying code before the migration remains safe.
        logging.warning("Could not persist pipeline status for %s: %s", entity_id, e)
    return run_id


async def run_analysis_pipeline(
    entity_id: str,
    brand_name: str,
    profile_type: str,
    social_handle: str | None = None,
    run_id: str | None = None,
    worker_token: str | None = None,
    is_recovery: bool = False,
):
    """
    Executes the heavy scraping and Groq AI tasks in the background.
    Now properly asynchronous to prevent event-loop blocking.
    """
    if run_id:
        _record_pipeline_run(
            entity_id, "running", "recovering" if is_recovery else "starting", run_id=run_id,
            worker_token=worker_token,
        )
    else:
        worker_token = str(uuid.uuid4())
        run_id = _record_pipeline_run(
            entity_id,
            "running",
            "starting",
            brand_name=brand_name,
            profile_type=profile_type,
            social_handle=social_handle,
            worker_token=worker_token,
        )
    try:
        print(f"Starting pipeline for {brand_name} ({profile_type})...")

        # Fire standard scrapers (blocking requests calls -> offload to threads).
        # YouTube/Twitter/Facebook are env-gated no-ops until their keys are set,
        # so this is safe to run today.
        _record_pipeline_run(entity_id, "running", "collecting_mentions", run_id=run_id, worker_token=worker_token)
        await asyncio.to_thread(scrape_nigerian_news, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_social_media, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_youtube, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_twitter, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_facebook, entity_id, brand_name, social_handle)

        # Fetch live web context using Tavily (natively async)
        _record_pipeline_run(entity_id, "running", "searching_web", run_id=run_id, worker_token=worker_token)
        live_context = await fetch_entity_context(brand_name, profile_type)

        # Run the synchronous sentiment analyzer off the event loop
        _record_pipeline_run(entity_id, "running", "analyzing_sentiment", run_id=run_id, worker_token=worker_token)
        analysis_result = await asyncio.to_thread(
            analyze_and_store_sentiment,
            entity_id,
            brand_name,
            live_context,
        )
        if analysis_result.get("failed", 0):
            raise RuntimeError(f"Sentiment analysis failed for {analysis_result['failed']} mention(s)")

        # Risk calculation is blocking (Supabase + Resend) -> offload
        _record_pipeline_run(entity_id, "running", "calculating_risk", run_id=run_id, worker_token=worker_token)
        await asyncio.to_thread(calculate_risk_and_alert, entity_id)
        _record_pipeline_run(entity_id, "completed", "completed", run_id=run_id, worker_token=worker_token)
        print(f"Pipeline complete for {brand_name}.")

    except Exception as e:
        logging.exception("Pipeline error for %s", brand_name)
        _record_pipeline_run(entity_id, "failed", "failed", str(e)[:500], run_id=run_id, worker_token=worker_token)


# =========================================================
# MANUAL ENDPOINTS
# =========================================================

@app.post("/sync/{entity_id}", dependencies=[Depends(verify_internal_key)])
def sync_all_sources(
    entity_id: str,
    brand_name: str | None = None,
    place_id: str = "mock_mode",
    social_handle: str | None = None,
):
    entity = _require_entity(entity_id)
    brand_name = entity["name"]
    social_handle = entity.get("social_handle")
    worker_token = str(uuid.uuid4())
    run_id = _record_pipeline_run(
        entity_id, "running", "starting", brand_name=brand_name,
        profile_type=entity.get("profile_type"), social_handle=social_handle,
        worker_token=worker_token,
    )
    _record_pipeline_run(
        entity_id, "running", "collecting_mentions", run_id=run_id,
        worker_token=worker_token,
    )
    try:
        news_count = scrape_nigerian_news(entity_id, brand_name, social_handle)
        google_count = fetch_google_reviews(entity_id, place_id)
        social_count = scrape_social_media(entity_id, brand_name, social_handle)
        youtube_count = scrape_youtube(entity_id, brand_name, social_handle)
        twitter_count = scrape_twitter(entity_id, brand_name, social_handle)
        facebook_count = scrape_facebook(entity_id, brand_name, social_handle)
    except Exception as exc:
        _record_pipeline_run(
            entity_id, "failed", "failed", str(exc)[:500], run_id=run_id,
            worker_token=worker_token,
        )
        raise

    return {
        "status": "Sync Complete",
        "pipeline_run_id": run_id,
        "worker_token": worker_token,
        "scraped_items": {
            "news_mentions": news_count,
            "google_reviews": google_count,
            "social_media_mentions": social_count,
            "youtube_mentions": youtube_count,
            "twitter_mentions": twitter_count,
            "facebook_mentions": facebook_count,
        },
    }

@app.post("/analyze", dependencies=[Depends(verify_internal_key)])
def trigger_analysis(
    entity_id: str = None,
    brand_name: str = None,
    limit: int | None = None,
    pipeline_run_id: str | None = None,
    worker_token: str | None = None,
):
    if not entity_id:
        raise HTTPException(status_code=400, detail="entity_id is required")
    entity = _require_entity(entity_id)
    brand_name = entity["name"]
    _record_pipeline_run(
        entity_id, "running", "analyzing_sentiment",
        run_id=pipeline_run_id, worker_token=worker_token,
    )
    try:
        result = analyze_and_store_sentiment(
            entity_id=entity_id,
            brand_name=brand_name,
            limit=limit,
        )
        if result.get("failed", 0):
            raise RuntimeError(
                f"Sentiment analysis failed for {result['failed']} mention(s)"
            )
    except Exception as exc:
        _record_pipeline_run(
            entity_id, "failed", "failed", str(exc)[:500],
            run_id=pipeline_run_id, worker_token=worker_token,
        )
        raise
    return {"status": "Analysis Complete", "mentions_scored": result}


@app.post("/entities/{entity_id}/analyze")
def trigger_owned_entity_analysis(
    entity_id: str,
    background_tasks: BackgroundTasks,
    user = Depends(enforce_user_mutation_limit),
):
    """Queue a full analysis pipeline for an entity owned by the caller."""
    entity = _require_owned_entity(entity_id, user.id)

    # Reserve the run before returning so rapid repeat clicks cannot enqueue
    # duplicate provider work in this application process.
    with _pipeline_schedule_lock:
        active_run = _get_active_pipeline_run(entity_id)
        if active_run:
            return {
                "status": "already_running",
                "scheduled": False,
                "entity_id": entity_id,
                "pipeline_run": active_run,
            }

        worker_token = str(uuid.uuid4())
        run_id = _record_pipeline_run(
            entity_id,
            "running",
            "starting",
            brand_name=entity["name"],
            profile_type=entity["profile_type"],
            social_handle=entity.get("social_handle"),
            worker_token=worker_token,
        )
        if not run_id:
            raise HTTPException(status_code=500, detail="Could not schedule analysis")

        background_tasks.add_task(
            run_analysis_pipeline,
            entity_id,
            entity["name"],
            entity["profile_type"],
            entity.get("social_handle"),
            run_id,
            worker_token,
        )

    return {
        "status": "scheduled",
        "scheduled": True,
        "entity_id": entity_id,
        "pipeline_run": {
            "id": run_id,
            "status": "running",
            "stage": "starting",
        },
    }


@app.post("/internal/reprocess-sentiment/{entity_id}", dependencies=[Depends(verify_internal_key)])
def trigger_sentiment_reprocess(entity_id: str, limit: int = 100):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 500")
    result = reprocess_existing_sentiment(entity_id, limit=limit)
    return {"status": "Reprocess Complete", **result}


@app.post("/internal/recover-pipelines", dependencies=[Depends(verify_internal_key)])
def recover_stale_pipelines(background_tasks: BackgroundTasks, limit: int = 10):
    """Atomically lease and resume pipelines interrupted by a restart/deploy."""
    if limit < 1 or limit > 50:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 50")
    try:
        result = supabase_admin.rpc(
            "claim_recoverable_pipeline_runs",
            {"p_limit": limit, "p_lease_seconds": PIPELINE_LEASE_SECONDS},
        ).execute()
    except Exception as exc:
        logging.exception("Could not claim stale pipelines")
        raise HTTPException(status_code=500, detail="Could not recover pipelines") from exc

    claimed = result.data or []
    for run in claimed:
        if not run.get("brand_name") or not run.get("profile_type"):
            _record_pipeline_run(
                run["entity_id"], "failed", "failed",
                "Recovery metadata is missing", run_id=run["id"],
                worker_token=run.get("worker_token"),
            )
            continue
        background_tasks.add_task(
            run_analysis_pipeline,
            run["entity_id"],
            run["brand_name"],
            run["profile_type"],
            run.get("social_handle"),
            run["id"],
            run.get("worker_token"),
            True,
        )
    return {
        "status": "Recovery Scheduled",
        "claimed": len(claimed),
        "entity_ids": [run["entity_id"] for run in claimed],
    }

@app.post("/calculate-risk/{entity_id}", dependencies=[Depends(verify_internal_key)])
def trigger_risk_calculation(
    entity_id: str,
    pipeline_run_id: str | None = None,
    worker_token: str | None = None,
):
    _require_entity(entity_id)
    _record_pipeline_run(
        entity_id, "running", "calculating_risk",
        run_id=pipeline_run_id, worker_token=worker_token,
    )
    try:
        result = calculate_risk_and_alert(entity_id)
    except Exception as exc:
        _record_pipeline_run(
            entity_id, "failed", "failed", str(exc)[:500],
            run_id=pipeline_run_id, worker_token=worker_token,
        )
        raise
    _record_pipeline_run(
        entity_id, "completed", "completed",
        run_id=pipeline_run_id, worker_token=worker_token,
    )
    return result

# =========================================================
# CREATE ENTITY (SECURE AUTHENTICATED HANDLER)
# =========================================================

@app.post("/entities")
async def create_new_entity(
    payload: BrandCreateRequest,
    background_tasks: BackgroundTasks, # Injected to prevent frontend hangups
    user = Depends(enforce_user_mutation_limit),
):
    """
    Creates a new monitored entity tied to the authenticated user.
    """
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if payload.profile_type not in VALID_PROFILE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid profile type")

    competitor_names = []
    seen_competitors = set()
    for raw_name in payload.competitors:
        comp_name = raw_name.strip()
        if not comp_name:
            raise HTTPException(status_code=400, detail="Competitor names cannot be empty")
        normalized = comp_name.casefold()
        if normalized == payload.name.strip().casefold():
            raise HTTPException(status_code=400, detail="An entity cannot be its own competitor")
        if normalized not in seen_competitors:
            seen_competitors.add(normalized)
            competitor_names.append(comp_name)

    user_id = user.id
    user_email = user.email

    try:
        entity_count = (
            supabase_admin.table("monitored_entities")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        ).count or 0
    except Exception as e:
        logging.error("Entity quota lookup failed for %s: %s", user_id, e)
        raise HTTPException(status_code=500, detail="Could not verify account limits")
    required_slots = 1 + len(competitor_names)
    if entity_count + required_slots > MAX_ENTITIES_PER_USER:
        raise HTTPException(
            status_code=409,
            detail=f"Entity limit reached. This account supports {MAX_ENTITIES_PER_USER} tracked profiles.",
        )

    # 2. Ensure profile exists
    try:
        supabase_admin.table("users").upsert({
            "id": user_id,
            "email": user_email,
        }).execute()
    except Exception as e:
        print("Profile upsert warning:", e)

    # 3. Insert primary entity with the new profile_type
    try:
        insert_payload = {
            "name": payload.name.strip(),
            "user_id": user_id,
            "profile_type": payload.profile_type,
        }
        if payload.social_handle and payload.social_handle.strip():
            insert_payload["social_handle"] = payload.social_handle.strip()

        insert_response = supabase_admin.table("monitored_entities").insert(insert_payload).execute()
    except Exception as e:
        logging.error("Entity insert failed for user %s: %s", user_id, str(e))
        raise HTTPException(status_code=500, detail="Could not create entity")

    if hasattr(insert_response, "error") and insert_response.error:
        raise HTTPException(status_code=400, detail=str(insert_response.error))

    new_entity = getattr(insert_response, "data", [None])[0]
    if not new_entity:
        raise HTTPException(status_code=500, detail="Failed to create entity record")

    entity_id = new_entity["id"]

    # 4. Handle Competitors (If provided in the payload)
    created_competitors = []
    if competitor_names:
        for comp_name in competitor_names:
            try:
                # Create the competitor entity owned by the same user so RLS
                # scopes it correctly (no orphaned null-owner rows).
                comp_insert = supabase_admin.table("monitored_entities").insert({
                    "name": comp_name.strip(),
                    "profile_type": payload.profile_type,
                    "user_id": user_id,
                }).execute()
                
                comp_id = comp_insert.data[0]["id"]
                
                # Link the primary user to this competitor. Clean up the child
                # entity if the link fails so it cannot become an orphan.
                try:
                    supabase_admin.table("competitor_links").insert({
                        "primary_entity_id": entity_id,
                        "competitor_entity_id": comp_id
                    }).execute()
                except Exception:
                    supabase_admin.table("monitored_entities").delete().eq("id", comp_id).execute()
                    raise
                created_competitors.append((comp_id, comp_name))
            except Exception as e:
                logging.error("Failed to map competitor %s: %s", comp_name, str(e))
                # Entity creation is one logical operation. Roll back every row
                # created by this request before returning an error.
                for created_id, _created_name in created_competitors:
                    try:
                        supabase_admin.table("monitored_entities").delete().eq("id", created_id).execute()
                    except Exception as cleanup_error:
                        logging.error("Competitor rollback failed for %s: %s", created_id, cleanup_error)
                try:
                    supabase_admin.table("monitored_entities").delete().eq("id", entity_id).execute()
                except Exception as cleanup_error:
                    logging.error("Primary entity rollback failed for %s: %s", entity_id, cleanup_error)
                raise HTTPException(status_code=500, detail="Could not create entity and competitors")

    # Queue the requested brand first. Starlette executes BackgroundTasks in
    # order, so putting competitors first made the user wait for every
    # competitor pipeline before their primary dashboard could become ready.
    background_tasks.add_task(
        run_analysis_pipeline,
        entity_id,
        payload.name.strip(),
        payload.profile_type,
        payload.social_handle.strip() if payload.social_handle else None,
    )

    # Queue provider work only after all database rows are valid.
    for comp_id, comp_name in created_competitors:
        background_tasks.add_task(
            run_analysis_pipeline, comp_id, comp_name, payload.profile_type, None
        )

    return {"success": True, "entity_id": entity_id}


@app.post("/entities/{entity_id}/competitors")
async def add_competitor(
    entity_id: str,
    payload: CompetitorAddRequest,
    background_tasks: BackgroundTasks,
    user = Depends(enforce_user_mutation_limit),
):
    """
    Links a new competitor to an existing entity owned by the caller.
    Mirrors the competitor-creation loop used at entity-create time.
    """
    comp_name = payload.name.strip()
    if not comp_name:
        raise HTTPException(status_code=400, detail="Competitor name cannot be empty")

    user_id = user.id

    # Verify the primary entity exists and belongs to the caller. supabase_admin
    # bypasses RLS, so we must enforce ownership here or a user could attach
    # competitors to another tenant's entity.
    try:
        primary = supabase_admin.table("monitored_entities") \
            .select("id, profile_type, user_id") \
            .eq("id", entity_id) \
            .maybe_single() \
            .execute()
    except Exception as e:
        logging.error("Entity lookup failed for %s: %s", entity_id, str(e))
        raise HTTPException(status_code=500, detail="Could not look up entity")

    primary_entity = getattr(primary, "data", None)
    if not primary_entity or primary_entity["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Entity not found")

    profile_type = primary_entity["profile_type"]

    try:
        links = (
            supabase_admin.table("competitor_links")
            .select("competitor_entity_id")
            .eq("primary_entity_id", entity_id)
            .execute()
        )
        linked_ids = [row["competitor_entity_id"] for row in (links.data or [])]
        if linked_ids:
            linked_entities = (
                supabase_admin.table("monitored_entities")
                .select("id, name")
                .in_("id", linked_ids)
                .execute()
            )
            for linked in linked_entities.data or []:
                if linked.get("name", "").strip().casefold() == comp_name.casefold():
                    return {
                        "success": True,
                        "competitor_entity_id": linked["id"],
                        "already_exists": True,
                    }

        if len(links.data or []) >= MAX_COMPETITORS_PER_ENTITY:
            raise HTTPException(
                status_code=409,
                detail=f"Competitor limit reached. Each profile supports {MAX_COMPETITORS_PER_ENTITY} competitors.",
            )

        entity_count = (
            supabase_admin.table("monitored_entities")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        ).count or 0
        if entity_count >= MAX_ENTITIES_PER_USER:
            raise HTTPException(
                status_code=409,
                detail=f"Entity limit reached. This account supports {MAX_ENTITIES_PER_USER} tracked profiles.",
            )

        # Create the competitor entity owned by the same user so RLS scopes it
        # correctly (no orphaned null-owner rows).
        comp_insert = supabase_admin.table("monitored_entities").insert({
            "name": comp_name,
            "profile_type": profile_type,
            "user_id": user_id,
        }).execute()

        comp_id = comp_insert.data[0]["id"]

        # Link the primary entity to this competitor.
        try:
            supabase_admin.table("competitor_links").insert({
                "primary_entity_id": entity_id,
                "competitor_entity_id": comp_id,
            }).execute()
        except Exception:
            # Avoid leaving an invisible orphan when the link insert fails.
            supabase_admin.table("monitored_entities").delete().eq("id", comp_id).execute()
            raise

        # Kick off analysis for the new competitor in the background.
        background_tasks.add_task(run_analysis_pipeline, comp_id, comp_name, profile_type)
    except HTTPException:
        raise
    except Exception as e:
        logging.error("Failed to add competitor %s to %s: %s", comp_name, entity_id, str(e))
        raise HTTPException(status_code=500, detail="Could not add competitor")

    return {"success": True, "competitor_entity_id": comp_id}


@app.patch("/recommendations/{recommendation_id}/dismiss")
def dismiss_recommendation(
    recommendation_id: str,
    payload: RecommendationDismissRequest,
    user = Depends(verify_user),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Recommendation title cannot be empty")

    try:
        result = (
            supabase_admin.table("recommendations")
            .select("id, entity_id, action_plan")
            .eq("id", recommendation_id)
            .maybe_single()
            .execute()
        )
        recommendation = getattr(result, "data", None)
        if not recommendation:
            raise HTTPException(status_code=404, detail="Recommendation not found")

        owner = (
            supabase_admin.table("monitored_entities")
            .select("user_id")
            .eq("id", recommendation["entity_id"])
            .maybe_single()
            .execute()
        )
        if not owner.data or owner.data.get("user_id") != user.id:
            raise HTTPException(status_code=404, detail="Recommendation not found")

        import json
        try:
            parsed = json.loads(recommendation.get("action_plan") or "{}")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="This recommendation cannot be dismissed individually")
        items = parsed.get("recommendations") if isinstance(parsed, dict) else None
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail="This recommendation cannot be dismissed individually")

        matched = False
        for item in items:
            if isinstance(item, dict) and str(item.get("title", "")).strip() == title:
                item["status"] = "dismissed"
                matched = True
        if not matched:
            raise HTTPException(status_code=404, detail="Recommendation item not found")

        supabase_admin.table("recommendations").update({
            "action_plan": json.dumps({**parsed, "recommendations": items})
        }).eq("id", recommendation_id).execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logging.error("Recommendation dismissal failed for %s: %s", recommendation_id, e)
        raise HTTPException(status_code=500, detail="Could not dismiss recommendation")


@app.patch("/entities/{entity_id}")
def update_entity(
    entity_id: str,
    payload: EntityUpdateRequest,
    user = Depends(verify_user),
):
    """Updates an entity owned by the authenticated user."""
    try:
        existing = (
            supabase_admin.table("monitored_entities")
            .select("id, user_id")
            .eq("id", entity_id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        logging.error("Entity lookup failed for %s: %s", entity_id, e)
        raise HTTPException(status_code=500, detail="Could not look up entity")

    entity = getattr(existing, "data", None)
    if not entity or entity["user_id"] != user.id:
        raise HTTPException(status_code=404, detail="Entity not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if not updates["name"]:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
    if "social_handle" in updates and updates["social_handle"] is not None:
        updates["social_handle"] = updates["social_handle"].strip() or None
    if "profile_type" in updates and updates["profile_type"] not in VALID_PROFILE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid profile type")

    if not updates:
        return {"success": True, "entity": entity}

    try:
        result = (
            supabase_admin.table("monitored_entities")
            .update(updates)
            .eq("id", entity_id)
            .execute()
        )
    except Exception as e:
        logging.error("Entity update failed for %s: %s", entity_id, e)
        raise HTTPException(status_code=500, detail="Could not update entity")

    updated = getattr(result, "data", [])
    return {"success": True, "entity": updated[0] if updated else {**entity, **updates}}
