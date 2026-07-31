import os
from typing import NoReturn

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

# 2. Admin client (bypasses RLS for backend system tasks)
if SUPABASE_SERVICE_ROLE:
    supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
else:
    class _MissingServiceRoleClient:
        """Fail clearly instead of silently running privileged work as anon."""

        @staticmethod
        def _raise() -> NoReturn:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE is required for backend system tasks"
            )

        def __getattr__(self, _name):
            self._raise()

    supabase_admin = _MissingServiceRoleClient()


def require_supabase_admin() -> Client:
    """Return the RLS-bypassing client or stop the system task immediately."""
    if not SUPABASE_SERVICE_ROLE:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE is required for backend system tasks"
        )
    return supabase_admin
