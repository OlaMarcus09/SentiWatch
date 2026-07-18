import os
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from database import supabase_admin
from constants import SOURCE_WEIGHTS

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
    Pulls public discussions using an open web aggregator layer.
    """
    query = brand_name.replace(" ", "+")
    url = f"https://www.reddit.com/search.rss?q={query}&sort=new"
    headers = {"User-Agent": "Mozilla/5.0 (SentiWatch Brand Agent v1.0)"}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return 0
            
        root = ET.fromstring(response.content)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        entries = root.findall(".//atom:entry", ns)
        
        inserted_count = 0
        for entry in entries[:5]:
            title_elem = entry.find("atom:title", ns)
            title = title_elem.text if title_elem is not None else ""
            link_elem = entry.find("atom:link", ns)
            link = link_elem.attrib['href'] if link_elem is not None else ""
            
            if not title or not link:
                continue
                
            exists = supabase_admin.table("mentions").select("id").eq("url", link).execute()
            if exists.data:
                continue
                
            supabase_admin.table("mentions").insert({
                "entity_id": entity_id,
                "source": "Public Forums (X/Reddit)",
                "content": title,
                "url": link,
                "created_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            inserted_count += 1
            
        return inserted_count
    except Exception as e:
        print(f"Social aggregation error for {brand_name}: {e}")
        return 0