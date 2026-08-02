import os
import logging
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from database import supabase_admin
from constants import SOURCE_WEIGHTS
from services import apify_client


def _normalise_timestamp(value):
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        parsed = parsedate_to_datetime(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).isoformat()
        except ValueError:
            return None


def _metadata_schema_missing(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "source_comment_id",
            "source_post_id",
            "raw_metadata",
            "published_at",
            "engagement",
            "platform",
            "schema cache",
        )
    )


def _insert_mention(
    entity_id: str,
    source: str,
    content: str,
    url: str,
    *,
    platform: str | None = None,
    source_post_id: str | None = None,
    source_comment_id: str | None = None,
    author_name: str | None = None,
    author_handle: str | None = None,
    engagement: dict | None = None,
    published_at=None,
    raw_metadata: dict | None = None,
) -> bool:
    """
    Dedup by entity + URL. The same article can legitimately mention multiple
    tracked entities, so URL-only deduplication loses data for later entities.
    Shared by all social scrapers so they behave identically.
    """
    if not content or not (url or source_comment_id or source_post_id):
        return False
    lookup = supabase_admin.table("mentions").select("id").eq("entity_id", entity_id)
    if source_comment_id and platform:
        lookup = lookup.eq("platform", platform).eq("source_comment_id", source_comment_id)
    elif url:
        lookup = lookup.eq("url", url)
    else:
        lookup = lookup.eq("platform", platform).eq("source_post_id", source_post_id)
    try:
        exists = lookup.execute()
    except Exception as exc:
        # Safe rolling deploy: old schemas can continue URL deduplication until
        # the recovery/source-metadata migration has been applied.
        if not url or not _metadata_schema_missing(exc):
            raise
        exists = (
            supabase_admin.table("mentions")
            .select("id")
            .eq("entity_id", entity_id)
            .eq("url", url)
            .execute()
        )
    if exists.data:
        return False
    payload = {
        "entity_id": entity_id,
        "source": source,
        "content": content[:2000],
        "url": url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "platform": platform or source,
        "source_post_id": str(source_post_id) if source_post_id else None,
        "source_comment_id": str(source_comment_id) if source_comment_id else None,
        "author_name": author_name,
        "author_handle": author_handle,
        "engagement": engagement or {},
        "published_at": _normalise_timestamp(published_at),
        "raw_metadata": raw_metadata or {},
    }
    try:
        supabase_admin.table("mentions").insert(payload).execute()
    except Exception as exc:
        if not _metadata_schema_missing(exc):
            raise
        legacy_payload = {
            key: payload[key]
            for key in ("entity_id", "source", "content", "url", "created_at")
        }
        supabase_admin.table("mentions").insert(legacy_payload).execute()
    return True

# ────────────────────────────────────────────────
# Helper: Fetch RSS Feed (BRAND-SPECIFIC)
# ────────────────────────────────────────────────
def fetch_rss_feed(brand_name: str = None, social_handle: str = None):
    """
    Fetches Nigerian news RSS feed.
    🔥 FIX: Now uses search-specific URL to only fetch brand-relevant articles.
    """
    search_name = " ".join(filter(None, [brand_name, social_handle]))
    if search_name:
        # Search for brand-specific articles
        query = search_name.replace(" ", "+")
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
def scrape_nigerian_news(entity_id: str, brand_name: str, social_handle: str = None) -> int:
    """
    🔥 FIX: Now passes brand_name to fetch_rss_feed() for search-specific results.
    No more manual filtering — the RSS search does it for us!
    """
    articles = fetch_rss_feed(brand_name, social_handle)
    inserted_count = 0
    
    try:
        for article in articles:
            title = article.get('title', '')
            link = article.get('link', '')
            
            # Check if already exists
            if _insert_mention(
                entity_id, "Nigerian News Feed", title, link,
                platform="news", published_at=article.get("published"),
            ):
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
            exists = (
                supabase_admin.table("mentions")
                .select("id")
                .eq("entity_id", entity_id)
                .eq("url", link)
                .execute()
            )
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
def scrape_social_media(entity_id: str, brand_name: str, social_handle: str = None) -> int:
    """
    Reddit — official public JSON search endpoint (upgrade from RSS).
    Pulls recent posts mentioning the brand; captures title + selftext and the
    permalink. No OAuth needed for low-volume public read.
    """
    query = (social_handle or brand_name).replace(" ", "+")
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

            if _insert_mention(
                entity_id,
                "Reddit",
                content,
                link,
                platform="reddit",
                source_post_id=post.get("id"),
                author_handle=post.get("author"),
                engagement={
                    "score": post.get("score", 0),
                    "comments": post.get("num_comments", 0),
                    "upvote_ratio": post.get("upvote_ratio"),
                },
                published_at=post.get("created_utc"),
                raw_metadata={"subreddit": post.get("subreddit")},
            ):
                inserted_count += 1

        return inserted_count
    except Exception as e:
        print(f"Reddit aggregation error for {brand_name}: {e}")
        return 0


# ────────────────────────────────────────────────
# 4. YouTube Scraper (comments on brand-related videos)
# ────────────────────────────────────────────────
def scrape_youtube(entity_id: str, brand_name: str, social_handle: str = None) -> int:
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
                "q": social_handle or brand_name,
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
                if _insert_mention(
                    entity_id,
                    "YouTube",
                    text,
                    link,
                    platform="youtube",
                    source_post_id=vid,
                    source_comment_id=comment_id,
                    author_name=snippet.get("authorDisplayName"),
                    author_handle=snippet.get("authorChannelId", {}).get("value"),
                    engagement={"likes": snippet.get("likeCount", 0)},
                    published_at=snippet.get("publishedAt"),
                ):
                    inserted_count += 1

        return inserted_count
    except Exception as e:
        print(f"YouTube scraping error for {brand_name}: {e}")
        return 0


# ────────────────────────────────────────────────
# 5. Twitter / X Scraper (via Apify actor — disabled until APIFY_TOKEN set)
# ────────────────────────────────────────────────
def scrape_twitter(entity_id: str, brand_name: str, social_handle: str = None) -> int:
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
        "searchTerms": [social_handle or brand_name],
        "maxItems": 25,
    })

    inserted_count = 0
    for it in items:
        # Actor field names vary; try the common ones.
        text = it.get("text") or it.get("full_text") or it.get("content") or ""
        link = it.get("url") or it.get("twitterUrl") or it.get("tweetUrl") or ""
        tweet_id = it.get("id") or it.get("tweetId") or it.get("id_str")
        if _insert_mention(
            entity_id,
            "Twitter/X",
            text,
            link,
            platform="twitter",
            source_post_id=tweet_id,
            author_name=it.get("authorName") or it.get("user", {}).get("name"),
            author_handle=it.get("author") or it.get("username") or it.get("user", {}).get("screen_name"),
            engagement={
                "likes": it.get("likeCount", it.get("favorite_count", 0)),
                "replies": it.get("replyCount", it.get("reply_count", 0)),
                "reposts": it.get("retweetCount", it.get("retweet_count", 0)),
            },
            published_at=it.get("createdAt") or it.get("created_at"),
        ):
            inserted_count += 1
    return inserted_count


# ────────────────────────────────────────────────
# 6. Facebook Scraper (via Apify actor — disabled until APIFY_TOKEN set)
# ────────────────────────────────────────────────
def scrape_facebook(entity_id: str, brand_name: str, social_handle: str = None) -> int:
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
        "query": social_handle or brand_name,
        "maxItems": 25,
    })

    inserted_count = 0
    for it in items:
        text = it.get("text") or it.get("message") or it.get("content") or ""
        link = it.get("url") or it.get("postUrl") or it.get("facebookUrl") or ""
        post_id = it.get("postId") or it.get("id")
        if _insert_mention(
            entity_id,
            "Facebook",
            text,
            link,
            platform="facebook",
            source_post_id=post_id,
            author_name=it.get("userName") or it.get("authorName") or it.get("pageName"),
            author_handle=it.get("userId") or it.get("pageId"),
            engagement={
                "likes": it.get("likes", it.get("likesCount", 0)),
                "comments": it.get("comments", it.get("commentsCount", 0)),
                "shares": it.get("shares", it.get("sharesCount", 0)),
            },
            published_at=it.get("time") or it.get("timestamp") or it.get("date"),
        ):
            inserted_count += 1
    return inserted_count
