from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends
from services.search_service import fetch_entity_context
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import asyncio
import secrets
import logging
from supabase import create_client, Client

from database import supabase, supabase_admin
from scrapers import (
    scrape_nigerian_news,
    fetch_google_reviews,
    scrape_social_media,
)
from sentiment import analyze_and_store_sentiment
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
    competitors: Optional[List[str]] = []  # Array of competitor names to track

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
        return {"database_status": "Connection failed", "error": str(e)}

# =========================================================
# BACKGROUND WORKER
# =========================================================

# 1. Change to `async def` to support the Tavily await call
async def run_analysis_pipeline(entity_id: str, brand_name: str, profile_type: str):
    """
    Executes the heavy scraping and Groq AI tasks in the background.
    Now properly asynchronous to prevent event-loop blocking.
    """
    try:
        print(f"Starting pipeline for {brand_name} ({profile_type})...")

        # Fire standard scrapers (blocking requests calls -> offload to threads)
        await asyncio.to_thread(scrape_nigerian_news, entity_id, brand_name)
        await asyncio.to_thread(scrape_social_media, entity_id, brand_name)

        # Fetch live web context using Tavily (natively async)
        live_context = await fetch_entity_context(brand_name, profile_type)

        # Run the synchronous sentiment analyzer off the event loop
        await asyncio.to_thread(
            analyze_and_store_sentiment,
            entity_id,
            brand_name,
            live_context,
        )

        # Risk calculation is blocking (Supabase + Resend) -> offload
        await asyncio.to_thread(calculate_risk_and_alert, entity_id)
        print(f"Pipeline complete for {brand_name}.")

    except Exception as e:
        print(f"Pipeline error for {brand_name}:", e)


# =========================================================
# MANUAL ENDPOINTS
# =========================================================

@app.post("/sync/{entity_id}", dependencies=[Depends(verify_internal_key)])
def sync_all_sources(entity_id: str, brand_name: str, place_id: str = "mock_mode"):
    news_count = scrape_nigerian_news(entity_id, brand_name)
    google_count = fetch_google_reviews(entity_id, place_id)
    social_count = scrape_social_media(entity_id, brand_name)

    return {
        "status": "Sync Complete",
        "scraped_items": {
            "news_mentions": news_count,
            "google_reviews": google_count,
            "social_media_mentions": social_count,
        },
    }

@app.post("/analyze", dependencies=[Depends(verify_internal_key)])
def trigger_analysis(entity_id: str = None, brand_name: str = None):
    result = analyze_and_store_sentiment(entity_id=entity_id, brand_name=brand_name)
    return {"status": "Analysis Complete", "mentions_scored": result}

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
        insert_response = supabase_admin.table("monitored_entities").insert({
            "name": payload.name,
            "user_id": user_id,
            "profile_type": payload.profile_type
        }).execute()
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
    if payload.competitors:
        for comp_name in payload.competitors:
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
                background_tasks.add_task(run_analysis_pipeline, comp_id, comp_name, payload.profile_type)
            except Exception as e:
                logging.error("Failed to map competitor %s: %s", comp_name, str(e))

    # 5. Trigger primary pipeline in the background
    background_tasks.add_task(run_analysis_pipeline, entity_id, payload.name, payload.profile_type)

    return {"success": True, "entity_id": entity_id}