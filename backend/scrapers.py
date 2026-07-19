import os
import logging
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from database import supabase_admin
from constants import SOURCE_WEIGHTS
from services import apify_client


def _insert_mention(entity_id: str, source: str, content: str, url: str) -> bool:
    """
    Dedup-by-url insert into `mentions`. Returns True if a new row was written.
    Shared by all social scrapers so they behave identically.
    """
    if not content or not url:
        return False
    exists = supabase_admin.table("mentions").select("id").eq("url", url).execute()
    if exists.data:
        return False
    supabase_admin.table("mentions").insert({
        "entity_id": entity_id,
        "source": source,
        "content": content[:2000],
        "url": url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return True

# ────────────────────────────────────────────────
# Helper: Fetch RSS Feed (BRAND-SPECIFIC)
# ────────────────────────────────────────────────
def fetch_rss_feed(brand_name: str = None):
    """
    Fetches Nigerian news RSS feed.
    🔥 FIX: Now uses search-specific URL to only fetch brand-relevant articles.
    """
    if brand_name:
        # Search for brand-specific articles
        query = brand_name.replace(" ", "+")
        url = f"https://news.google.com/rss/search?q={query}&hl=en-NG&gl=NG&ceid=NG:en"
    else:
        # Fallback to general feed
        url = "https://news.google.com/rss?hl=en-NG&gl=NG&ceid=NG:en"
    
    headers = {"User-Agent": "Mozilla/5.0 (SentiWatch v1.0)"}
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return []
        root = ET.fromstring(response.content)
        entries = root.findall(".//item")
        articles = []
        for entry in entries[:25]:
            title = entry.find("title")
            link = entry.find("link")
            description = entry.find("description")
            pub_date = entry.find("pubDate")
            articles.append({
                "title": title.text if title is not None else "",
                "link": link.text if link is not None else "",
                "description": description.text if description is not None else "",
                "published": pub_date.text if pub_date is not None else ""
            })
        return articles
    except Exception as e:
        print(f"RSS fetch error: {e}")
        return []


# ────────────────────────────────────────────────
# 1. Nigerian News Scraper (BRAND-ONLY)
# ────────────────────────────────────────────────
def scrape_nigerian_news(entity_id: str, brand_name: str) -> int:
    """
    🔥 FIX: Now passes brand_name to fetch_rss_feed() for search-specific results.
    No more manual filtering — the RSS search does it for us!
    """
    articles = fetch_rss_feed(brand_name)
    inserted_count = 0
    
    try:
        for article in articles:
            title = article.get('title', '')
            link = article.get('link', '')
            
            # Check if already exists
            exists = supabase_admin.table("mentions").select("id").eq("url", link).execute()
            if exists.data:
                continue
            
            # Insert directly — no filter needed since RSS search already filtered
            supabase_admin.table("mentions").insert({
                "entity_id": entity_id,
                "content": title,
                "url": link,
                "source": "Nigerian News Feed",
                "created_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            inserted_count += 1
        
        return inserted_count
    
    except Exception as e:
        print(f"News scraping error for {brand_name}: {e}")
        return 0


# ────────────────────────────────────────────────
# 2. Google Reviews Scraper
# ────────────────────────────────────────────────
def fetch_google_reviews(entity_id: str, place_id: str) -> int:
    """
    Real-world Google Places API integration placeholder.
    To turn this live, get a free $200/month credit key from Google Cloud Console.
    """
    try:
        if place_id == "mock_mode":
            # Only inject synthetic review data when explicitly enabled (dev/demo).
            # In production this stays off so real data is never polluted.
            if os.getenv("ENABLE_MOCK_REVIEWS", "false").lower() != "true":
                return 0

            # Fallback to a realistic data entry if no real place_id is passed yet
            link = "https://maps.google.com/?cid=mock"
            exists = supabase_admin.table("mentions").select("id").eq("url", link).execute()
            if exists.data:
                return 0
                
            supabase_admin.table("mentions").insert({
                "entity_id": entity_id,
                "source": "Google Maps",
                "content": "The service speed at this branch was completely unacceptable. Long queues outside.",
                "url": link,
                "created_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            return 1

        # Real implementation when you drop in your GOOGLE_MAPS_API_KEY:
        # api_key = os.getenv("GOOGLE_MAPS_API_KEY")
        # url = f"https://maps.googleapis.com/maps/api/place/details/json?place_id={place_id}&fields=reviews&key={api_key}"
        # ... parse response.json()['result']['reviews']
        return 0
    except Exception as e:
        print(f"Google Reviews error for {entity_id}: {e}")
        return 0


# ────────────────────────────────────────────────
# 3. Social Media Scraper (Reddit/X)
# ────────────────────────────────────────────────
def scrape_social_media(entity_id: str, brand_name: str) -> int:
    """
    Reddit — official public JSON search endpoint (upgrade from RSS).
    Pulls recent posts mentioning the brand; captures title + selftext and the
    permalink. No OAuth needed for low-volume public read.
    """
    query = brand_name.replace(" ", "+")
    url = f"https://www.reddit.com/search.json?q={query}&sort=new&limit=25"
    headers = {"User-Agent": "SentiWatch/1.0 (brand reputation monitor)"}

    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            logging.warning("Reddit search returned %s for %s", response.status_code, brand_name)
            return 0

        children = response.json().get("data", {}).get("children", [])
        inserted_count = 0
        for child in children:
            post = child.get("data", {})
            title = post.get("title", "") or ""
            selftext = post.get("selftext", "") or ""
            content = f"{title}\n\n{selftext}".strip()
            permalink = post.get("permalink", "")
            link = f"https://www.reddit.com{permalink}" if permalink else post.get("url", "")

            if _insert_mention(entity_id, "Reddit", content, link):
                inserted_count += 1

        return inserted_count
    except Exception as e:
        print(f"Reddit aggregation error for {brand_name}: {e}")
        return 0


# ────────────────────────────────────────────────
# 4. YouTube Scraper (comments on brand-related videos)
# ────────────────────────────────────────────────
def scrape_youtube(entity_id: str, brand_name: str) -> int:
    """
    YouTube Data API v3. Searches videos for the brand, then pulls top-level
    comments. No-op returning 0 when YOUTUBE_API_KEY is unset.
    """
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        logging.info("YOUTUBE_API_KEY unset; skipping YouTube scrape.")
        return 0

    inserted_count = 0
    try:
        search = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet",
                "q": brand_name,
                "type": "video",
                "maxResults": 5,
                "order": "date",
                "key": api_key,
            },
            timeout=10,
        )
        if search.status_code != 200:
            logging.warning("YouTube search returned %s: %s", search.status_code, search.text[:200])
            return 0

        video_ids = [
            item["id"]["videoId"]
            for item in search.json().get("items", [])
            if item.get("id", {}).get("videoId")
        ]

        for vid in video_ids:
            comments = requests.get(
                "https://www.googleapis.com/youtube/v3/commentThreads",
                params={
                    "part": "snippet",
                    "videoId": vid,
                    "maxResults": 10,
                    "order": "relevance",
                    "textFormat": "plainText",
                    "key": api_key,
                },
                timeout=10,
            )
            if comments.status_code != 200:
                # Comments can be disabled per-video; skip quietly.
                continue

            for item in comments.json().get("items", []):
                top = item.get("snippet", {}).get("topLevelComment", {})
                snippet = top.get("snippet", {})
                text = snippet.get("textDisplay", "") or ""
                comment_id = top.get("id", "")
                link = f"https://www.youtube.com/watch?v={vid}&lc={comment_id}" if comment_id else ""
                if _insert_mention(entity_id, "YouTube", text, link):
                    inserted_count += 1

        return inserted_count
    except Exception as e:
        print(f"YouTube scraping error for {brand_name}: {e}")
        return 0


# ────────────────────────────────────────────────
# 5. Twitter / X Scraper (via Apify actor — disabled until APIFY_TOKEN set)
# ────────────────────────────────────────────────
def scrape_twitter(entity_id: str, brand_name: str) -> int:
    """
    X/Twitter has no free read API. This routes through an Apify actor and is a
    no-op until APIFY_TOKEN (and APIFY_TWITTER_ACTOR) are configured.
    """
    if not apify_client.is_enabled():
        return 0

    actor_id = os.getenv("APIFY_TWITTER_ACTOR", "")
    if not actor_id:
        logging.info("APIFY_TWITTER_ACTOR unset; skipping Twitter scrape.")
        return 0

    items = apify_client.run_actor(actor_id, {
        "searchTerms": [brand_name],
        "maxItems": 25,
    })

    inserted_count = 0
    for it in items:
        # Actor field names vary; try the common ones.
        text = it.get("text") or it.get("full_text") or it.get("content") or ""
        link = it.get("url") or it.get("twitterUrl") or it.get("tweetUrl") or ""
        if _insert_mention(entity_id, "Twitter/X", text, link):
            inserted_count += 1
    return inserted_count


# ────────────────────────────────────────────────
# 6. Facebook Scraper (via Apify actor — disabled until APIFY_TOKEN set)
# ────────────────────────────────────────────────
def scrape_facebook(entity_id: str, brand_name: str) -> int:
    """
    Facebook exposes no free brand-mention search. Routes through an Apify actor
    and is a no-op until APIFY_TOKEN (and APIFY_FACEBOOK_ACTOR) are configured.
    """
    if not apify_client.is_enabled():
        return 0

    actor_id = os.getenv("APIFY_FACEBOOK_ACTOR", "")
    if not actor_id:
        logging.info("APIFY_FACEBOOK_ACTOR unset; skipping Facebook scrape.")
        return 0

    items = apify_client.run_actor(actor_id, {
        "query": brand_name,
        "maxItems": 25,
    })

    inserted_count = 0
    for it in items:
        text = it.get("text") or it.get("message") or it.get("content") or ""
        link = it.get("url") or it.get("postUrl") or it.get("facebookUrl") or ""
        if _insert_mention(entity_id, "Facebook", text, link):
            inserted_count += 1
    return inserted_count