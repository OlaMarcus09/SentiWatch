import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials. Check your .env file.")

# 1. Standard client (Subject to RLS rules)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 2. Admin client (Bypasses RLS for backend system tasks)
if SUPABASE_SERVICE_ROLE:
    supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
else:
    supabase_admin = supabase