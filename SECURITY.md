# SentiWatch Security Overview

This document describes the security model of SentiWatch and the actions
required to keep a deployment secure. It reflects the hardening pass applied
to the backend (FastAPI) and frontend (Next.js) code.

---

## 1. Authentication model

SentiWatch has two classes of endpoints, each with its own auth mechanism.

### User-facing endpoints (Supabase JWT)
- `POST /entities` — create a monitored entity.
- Auth: the frontend sends the Supabase session token as
  `Authorization: Bearer <jwt>`. The backend verifies it via
  `supabase_admin.auth.get_user(token)` in the reusable `verify_user`
  dependency (`backend/main.py`).
- On any failure the endpoint returns a generic `401` — internal error
  strings are logged server-side, never returned to the client.

### Machine-to-machine endpoints (internal key)
- `POST /sync/{entity_id}`, `POST /analyze`, `POST /calculate-risk/{entity_id}`.
- These are triggered by the cron pipeline (`backend/cron_sync.py`), which has
  no user session, so they are guarded by a shared secret instead of a JWT.
- Auth: the caller must send `X-Internal-Key: <INTERNAL_API_KEY>`. The backend
  checks it with a constant-time comparison (`secrets.compare_digest`) in the
  `verify_internal_key` dependency.
- **Fail-closed:** if `INTERNAL_API_KEY` is not set on the server, these
  endpoints return `503` rather than allowing open access.

---

## 2. Required environment variables

These are secrets and must **never** be committed. `.env` / `.env.local` are
gitignored and confirmed untracked.

### `backend/.env` (and Render env + cron env)
| Key | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase anon key (RLS-scoped client) |
| `SUPABASE_SERVICE_ROLE` | Service-role key (bypasses RLS — backend only) |
| `GROQ_API_KEY` | Groq LLM key |
| `TAVILY_API_KEY` | Tavily web search key |
| `RESEND_API_KEY` | Resend email key |
| **`INTERNAL_API_KEY`** | **NEW — shared secret for internal endpoints. Add this.** |
| `ENABLE_MOCK_REVIEWS` | Optional. `true` only in dev/demo. Leave unset/`false` in prod. |
| `BACKEND_URL` | Base URL the cron uses to reach the API |

### Generate a strong `INTERNAL_API_KEY`
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```
Add the same value to:
1. `backend/.env` (local)
2. Render service environment (the API)
3. The cron job's environment (so `cron_sync.py` can send the header)

If these three don't match, the cron pipeline gets `401` and the internal
endpoints get `503` (if the API key is missing entirely).

---

## 3. Fixes applied in this pass

| # | Issue | Resolution |
|---|-------|------------|
| 1 | `tavily` missing from `requirements.txt` → deploy crash | Added `tavily-python==0.7.26` |
| 2 | `/analyze` awaited nothing → sentiment scoring silently no-op'd | `analyze_and_store_sentiment` made sync; callers updated |
| 3 | Blocking I/O on the async event loop | Blocking calls offloaded via `asyncio.to_thread` |
| 4 | `/sync`, `/analyze`, `/calculate-risk` had no auth | `verify_internal_key` dependency (X-Internal-Key) |
| 5 | Inline token verification duplicated in `/entities` | Extracted reusable `verify_user` dependency |
| 6 | Competitor entities created with null `user_id` | Now owned by the creating user (RLS-scoped) |
| 7 | Error `str(e)` leaked to clients | Logged server-side; generic client messages |
| 8 | Mock Google review injected in prod | Gated behind `ENABLE_MOCK_REVIEWS` (default off) |
| 9 | Bare `except:` in scoring | Narrowed to specific exception types |
| 10 | Frontend swallowed create errors | Inline error message added to `CreateEntityForm` |

---

## 4. Row-Level Security (RLS) — ACTION REQUIRED

**This is the highest-value item to verify.** The frontend reads data directly
from Supabase using the **anon key** (see `frontend/src/app/page.tsx`, which
queries `monitored_entities`, `mentions`, `sentiment_results`, `risk_scores`,
`recommendations`, `competitor_links`). That means **RLS policies are the ONLY
thing preventing one tenant from reading another tenant's data.** If RLS is
disabled or misconfigured, any logged-in user can read every user's data.

> Note: RLS cannot be verified from the application code — it lives in the
> Supabase Postgres instance. Run the SQL below in the **Supabase SQL Editor**.

### 4a. Confirm RLS is enabled on every table
```sql
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'monitored_entities', 'mentions', 'sentiment_results',
    'risk_scores', 'recommendations', 'competitor_links', 'users'
  )
order by relname;
```
Every row must show `rls_enabled = true`. Enable any that are false:
```sql
alter table public.<table_name> enable row level security;
```

### 4b. Review existing policies
```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

### 4c. Expected policy shape
- `monitored_entities`: users may select/insert/update/delete only rows where
  `user_id = auth.uid()`.
- Child tables (`mentions`, `sentiment_results`, `risk_scores`,
  `recommendations`): a user may select a row only if its parent entity belongs
  to them (join back to `monitored_entities.user_id = auth.uid()`).
- `competitor_links`: readable only when the `primary_entity_id` belongs to the
  requesting user.
- `users`: a user may select/update only their own row (`id = auth.uid()`).

### 4d. Example policies (apply only where missing)
```sql
-- Owners can read their own entities
create policy "entities_select_own"
on public.monitored_entities for select
using (user_id = auth.uid());

-- Read mentions only for entities you own
create policy "mentions_select_own"
on public.mentions for select
using (
  exists (
    select 1 from public.monitored_entities e
    where e.id = mentions.entity_id
      and e.user_id = auth.uid()
  )
);
```
Replicate the child-table pattern for `sentiment_results` (join through
`mentions` → `monitored_entities`), `risk_scores`, and `recommendations`.

```sql
-- Read competitor links only for a primary entity you own.
-- REQUIRED: without this, RLS fails closed and the Competitors tab renders
-- the empty state even when links exist (the browser reads via the anon key).
create policy "competitor_links_select_own"
on public.competitor_links for select
using (
  exists (
    select 1 from public.monitored_entities e
    where e.id = competitor_links.primary_entity_id
      and e.user_id = auth.uid()
  )
);
```

> The backend uses the **service-role** key, which bypasses RLS by design — all
> its writes are intentional and authenticated at the endpoint layer. RLS
> protects the **anon-key path used by the browser**, which is what matters here.

---

## 5. Recommended next steps (not yet implemented)

- **Rate limiting** on the internal + auth endpoints (e.g. slowapi) to curb
  brute force and quota abuse.
- **Ownership check on internal routes:** `/sync`, `/analyze`,
  `/calculate-risk` currently trust any caller with the internal key. Fine for a
  trusted cron, but if these ever get exposed to users, add an
  entity-ownership check.
- **Google Places integration:** wire a real `GOOGLE_MAPS_API_KEY` so the mock
  path can be retired entirely.
- **Dependency scanning** (e.g. `pip-audit`, `npm audit`) in CI.
