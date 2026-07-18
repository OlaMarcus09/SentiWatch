import os
import json
from abc import ABC, abstractmethod
from groq import AsyncGroq

class LLMProvider(ABC):
    @abstractmethod
    async def generate_response(self, prompt: str, system_message: str) -> dict:
        """Must return a parsed JSON dictionary."""
        pass

class GroqAdapter(LLMProvider):
    def __init__(self):
        # Requires GROQ_API_KEY in your Railway environment
        self.client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
        self.model = "llama-3.3-70b-versatile"

    async def generate_response(self, prompt: str, system_message: str) -> dict:
        try:
            response = await self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": prompt}
                ],
                model=self.model,
                temperature=0.2, # Keep hallucination risk low
                response_format={"type": "json_object"} # Forces valid JSON output
            )
            
            raw_content = response.choices[0].message.content
            return json.loads(raw_content)
            
        except Exception as e:
            print(f"Groq API Error: {str(e)}")
            # Return a safe fallback JSON so the Supabase insert doesn't crash
            return {
                "sentiment_label": "neutral",
                "confidence": 0,
                "category": "error",
                "severity_score": 0,
                "recommendation": "Analysis failed due to LLM provider error."
            }