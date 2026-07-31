from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends
from services.search_service import fetch_entity_context
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import asyncio
import secrets
import logging
from datetime import datetime, timezone
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
from risk_engine import calculate_risk_and_alert

# PIVOT TODO: Import your new search service here once you create the file
# from services.search_service import fetch_entity_context

# =========================================================
# APP INITIALIZATION
# =========================================================

app = FastAPI(title="SentiWatch API - SaaS Version")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://senti-watch.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# REQUEST MODELS
# =========================================================

class BrandCreateRequest(BaseModel):
    name: str
    # New Pivot Fields
    profile_type: str = "business"  # e.g., student, influencer, business, real_estate
    social_handle: Optional[str] = None  # e.g., @gtbank
    competitors: List[str] = Field(default_factory=list)


class CompetitorAddRequest(BaseModel):
    name: str  # Competitor name to link to an existing entity


class EntityUpdateRequest(BaseModel):
    name: Optional[str] = None
    profile_type: Optional[str] = None
    social_handle: Optional[str] = None


class NotificationPreferencesRequest(BaseModel):
    email_alerts_enabled: bool = True
    daily_digest_enabled: bool = False


class RecommendationDismissRequest(BaseModel):
    title: str


VALID_PROFILE_TYPES = {"business", "influencer", "student", "real_estate"}

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

    token = authorization.replace("Bearer ", "").strip()
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
        # Digest delivery is not scheduled yet. Expose that explicitly instead
        # of presenting a persisted switch as a working notification channel.
        return {**preferences, "daily_digest_available": False}
    except Exception as e:
        logging.error("Notification preferences lookup failed for %s: %s", user.id, e)
        raise HTTPException(status_code=500, detail="Could not load notification preferences")


@app.put("/notification-preferences")
def update_notification_preferences(
    payload: NotificationPreferencesRequest,
    user = Depends(verify_user),
):
    if payload.daily_digest_enabled:
        raise HTTPException(status_code=400, detail="Daily digest delivery is not available yet")
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
    return {**result_preferences, "daily_digest_available": False}

# =========================================================
# BACKGROUND WORKER
# =========================================================

# 1. Change to `async def` to support the Tavily await call
def _record_pipeline_run(entity_id: str, status: str, stage: str, error: str | None = None):
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
    if status in {"completed", "failed"}:
        payload["finished_at"] = payload["updated_at"]

    try:
        if status == "running" and stage == "starting":
            supabase_admin.table("pipeline_runs").insert(payload).execute()
            return

        existing = (
            supabase_admin.table("pipeline_runs")
            .select("id")
            .eq("entity_id", entity_id)
            .eq("status", "running")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        if existing.data:
            (
                supabase_admin.table("pipeline_runs")
                .update(payload)
                .eq("id", existing.data[0]["id"])
                .execute()
            )
        else:
            supabase_admin.table("pipeline_runs").insert(payload).execute()
    except Exception as e:
        # Deploying code before the migration remains safe.
        logging.warning("Could not persist pipeline status for %s: %s", entity_id, e)


async def run_analysis_pipeline(
    entity_id: str,
    brand_name: str,
    profile_type: str,
    social_handle: str | None = None,
):
    """
    Executes the heavy scraping and Groq AI tasks in the background.
    Now properly asynchronous to prevent event-loop blocking.
    """
    _record_pipeline_run(entity_id, "running", "starting")
    try:
        print(f"Starting pipeline for {brand_name} ({profile_type})...")

        # Fire standard scrapers (blocking requests calls -> offload to threads).
        # YouTube/Twitter/Facebook are env-gated no-ops until their keys are set,
        # so this is safe to run today.
        _record_pipeline_run(entity_id, "running", "collecting_mentions")
        await asyncio.to_thread(scrape_nigerian_news, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_social_media, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_youtube, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_twitter, entity_id, brand_name, social_handle)
        await asyncio.to_thread(scrape_facebook, entity_id, brand_name, social_handle)

        # Fetch live web context using Tavily (natively async)
        _record_pipeline_run(entity_id, "running", "searching_web")
        live_context = await fetch_entity_context(brand_name, profile_type)

        # Run the synchronous sentiment analyzer off the event loop
        _record_pipeline_run(entity_id, "running", "analyzing_sentiment")
        await asyncio.to_thread(
            analyze_and_store_sentiment,
            entity_id,
            brand_name,
            live_context,
        )

        # Risk calculation is blocking (Supabase + Resend) -> offload
        _record_pipeline_run(entity_id, "running", "calculating_risk")
        await asyncio.to_thread(calculate_risk_and_alert, entity_id)
        _record_pipeline_run(entity_id, "completed", "completed")
        print(f"Pipeline complete for {brand_name}.")

    except Exception as e:
        logging.exception("Pipeline error for %s", brand_name)
        _record_pipeline_run(entity_id, "failed", "failed", str(e)[:500])


# =========================================================
# MANUAL ENDPOINTS
# =========================================================

@app.post("/sync/{entity_id}", dependencies=[Depends(verify_internal_key)])
def sync_all_sources(
    entity_id: str,
    brand_name: str,
    place_id: str = "mock_mode",
    social_handle: str | None = None,
):
    news_count = scrape_nigerian_news(entity_id, brand_name, social_handle)
    google_count = fetch_google_reviews(entity_id, place_id)
    social_count = scrape_social_media(entity_id, brand_name, social_handle)
    youtube_count = scrape_youtube(entity_id, brand_name, social_handle)
    twitter_count = scrape_twitter(entity_id, brand_name, social_handle)
    facebook_count = scrape_facebook(entity_id, brand_name, social_handle)

    return {
        "status": "Sync Complete",
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
def trigger_analysis(entity_id: str = None, brand_name: str = None):
    result = analyze_and_store_sentiment(entity_id=entity_id, brand_name=brand_name)
    return {"status": "Analysis Complete", "mentions_scored": result}


@app.post("/internal/reprocess-sentiment/{entity_id}", dependencies=[Depends(verify_internal_key)])
def trigger_sentiment_reprocess(entity_id: str, limit: int = 100):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 500")
    result = reprocess_existing_sentiment(entity_id, limit=limit)
    return {"status": "Reprocess Complete", **result}

@app.post("/calculate-risk/{entity_id}", dependencies=[Depends(verify_internal_key)])
def trigger_risk_calculation(entity_id: str):
    result = calculate_risk_and_alert(entity_id)
    return result

# =========================================================
# CREATE ENTITY (SECURE AUTHENTICATED HANDLER)
# =========================================================

@app.post("/entities")
async def create_new_entity(
    payload: BrandCreateRequest,
    background_tasks: BackgroundTasks, # Injected to prevent frontend hangups
    user = Depends(verify_user),
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
                
                # Link the primary user to this competitor
                supabase_admin.table("competitor_links").insert({
                    "primary_entity_id": entity_id,
                    "competitor_entity_id": comp_id
                }).execute()
                
                # Trigger a separate background task to analyze the competitor
                background_tasks.add_task(run_analysis_pipeline, comp_id, comp_name, payload.profile_type, None)
            except Exception as e:
                logging.error("Failed to map competitor %s: %s", comp_name, str(e))

    # 5. Trigger primary pipeline in the background
    background_tasks.add_task(
        run_analysis_pipeline,
        entity_id,
        payload.name.strip(),
        payload.profile_type,
        payload.social_handle.strip() if payload.social_handle else None,
    )

    return {"success": True, "entity_id": entity_id}


@app.post("/entities/{entity_id}/competitors")
async def add_competitor(
    entity_id: str,
    payload: CompetitorAddRequest,
    background_tasks: BackgroundTasks,
    user = Depends(verify_user),
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

        # Create the competitor entity owned by the same user so RLS scopes it
        # correctly (no orphaned null-owner rows).
        comp_insert = supabase_admin.table("monitored_entities").insert({
            "name": comp_name,
            "profile_type": profile_type,
            "user_id": user_id,
        }).execute()

        comp_id = comp_insert.data[0]["id"]

        # Link the primary entity to this competitor.
        supabase_admin.table("competitor_links").insert({
            "primary_entity_id": entity_id,
            "competitor_entity_id": comp_id,
        }).execute()

        # Kick off analysis for the new competitor in the background.
        background_tasks.add_task(run_analysis_pipeline, comp_id, comp_name, profile_type)
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
