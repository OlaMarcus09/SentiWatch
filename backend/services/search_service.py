import os
from tavily import AsyncTavilyClient
# If you don't have the async client yet, you can also use httpx manually as shown previously, 
# but the official AsyncTavilyClient is cleaner and handles retries.

async def fetch_entity_context(entity_name: str, profile_type: str) -> str:
    """
    Fetches real-time web data based on the persona using the Tavily API.
    Returns clean markdown context for the LLM.
    """
    try:
        # Initialize the official async client using your environment variable
        client = AsyncTavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
        
        # 1. Build a targeted query based on the database profile_type
        if profile_type == "student":
            # Target forums, news, or aggressive social mentions (visa risk factors)
            query = f'"{entity_name}" (scandal OR controversy OR political OR news OR twitter OR nairaland)'
            search_depth = "advanced" # Dig deeper for students
        elif profile_type == "business":
            # Target customer reviews and operational complaints
            query = f'"{entity_name}" reviews OR complaints OR scam OR news'
            search_depth = "basic"
        elif profile_type == "real_estate":
            # Target property disputes or tenant reviews
            query = f'"{entity_name}" property OR tenant reviews OR land dispute OR estate'
            search_depth = "advanced"
        elif profile_type == "influencer":
            # Target brand deals, controversies, and general sentiment
            query = f'"{entity_name}" influencer OR controversy OR brand deal OR twitter'
            search_depth = "basic"
        else:
            query = f'"{entity_name}" news OR mentions'
            search_depth = "basic"

        # 2. Execute the Tavily Search
        response = await client.search(
            query=query,
            search_depth=search_depth,
            include_raw_content=True, # Critical: Gives Groq the actual paragraph text, not just links
            max_results=5
        )
        
        # 3. Aggregate the raw content into a single block of context for Groq
        results = response.get("results", [])
        if not results:
            return "No recent web mentions found."
            
        context_blocks = []
        for res in results:
            content = res.get("raw_content") or res.get("content") or ""
            if content:
                context_blocks.append(f"Source: {res.get('url')}\nContent: {content[:1000]}") # Cap length per source
                
        return "\n\n---\n\n".join(context_blocks)

    except Exception as e:
        print(f"Tavily Search Error for {entity_name}: {str(e)}")
        return "Search failed. Defaulting to scraped database mentions."