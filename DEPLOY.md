# SentiWatch Deployment (Render + GitHub Actions)

## Production release gate

For a new Supabase project, apply `scripts/0001_baseline_schema.sql` first.
For every environment, apply all dated migrations in filename order. The
production-readiness migration is backward-compatible with installations that
missed the optional metadata or notification migrations. Then run the read-only
`scripts/verify_production_schema.sql` report. Do not deploy unless every
listed tenant table has RLS enabled, the expected policies and indexes are
present, and the integrity query returns zero rows.

If an earlier production-readiness attempt failed, PostgreSQL rolled back the
transaction. Pull the corrected migration and rerun the complete file.

Required production configuration now also includes:

- `ALLOWED_ORIGINS` — comma-separated exact frontend origins.
- `SCORING_WINDOW_DAYS` — defaults to 90.
- `MAX_SCORING_MENTIONS` — defaults to 500 per entity calculation.
- `MAX_ENTITIES_PER_USER` — defaults to 10, including competitor entities.
- `MAX_COMPETITORS_PER_ENTITY` — defaults to 3.
- `USER_MUTATION_LIMIT_PER_MINUTE` — defaults to 10.

After deployment, `GET /health/ready` must return HTTP 200. The endpoint fails
closed when the service-role key, internal key, LLM provider, or database is
not ready.

Before deploying the reputation-integrity update, run
`scripts/2026-07-30_reputation_integrity.sql` once in the Supabase SQL editor.
It enables entity-scoped mention deduplication, risk-score history, and durable
background-pipeline status reporting.

Run `scripts/2026-07-31_notification_preferences.sql` as well to enable the
persisted email-alert and daily-digest controls in Settings.
Run `scripts/2026-07-31_notification_delivery.sql` to create the in-app
notification inbox and daily-digest delivery cursor. Schedule a daily request
to `POST /internal/send-daily-digests` with the `X-Internal-Key` header.

Run `scripts/2026-07-31_backend_hardening.sql` to enable owned recommendation
reads and enforce unique competitor links before deploying this hardening pass.

Run `scripts/2026-07-31_pipeline_recovery.sql` before deploying pipeline
recovery and enriched social connectors. It adds pipeline leases/retry metadata,
an atomic service-role recovery claim, and the structured mention metadata
columns used by Reddit, YouTube, X, Facebook, and news ingestion.

Railway's trial expired, so the backend now runs on **Render's free tier**
(no credit card, never expires) and the hourly pipeline runs as a **free
GitHub Actions scheduled workflow** instead of an always-on worker.

```
Browser ──> Vercel (Next.js frontend)
                 │  reads Supabase directly (anon key + RLS)
                 ▼
             Supabase (Postgres)
                 ▲
   Render free web service (FastAPI)  ← wakes on request
                 ▲
   GitHub Actions cron (hourly) ── warms + drives the pipeline
```

Only the FastAPI backend moves. Supabase, Groq, Tavily, and Resend are all
external services and don't change.

---

## Part 1 — Deploy the backend to Render

### 1. Create the service
1. Go to [render.com](https://render.com) and sign up with GitHub (no card required).
2. **New +** → **Blueprint** → pick the `SentiWatch` repo. Render reads
   `render.yaml` at the repo root and provisions the `sentiwatch-api` web service.
   - If you prefer manual setup instead of the blueprint: **New + → Web Service**,
     set **Root Directory** = `backend`, **Build** = `pip install -r requirements.txt`,
     **Start** = `uvicorn main:app --host 0.0.0.0 --port $PORT`.

### 2. Set environment variables (Render dashboard → your service → Environment)
All are marked `sync: false` in `render.yaml`, so you must enter the real values here.

| Key | Required | Notes |
|-----|----------|-------|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_KEY` | yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE` | yes | Service-role key (backend bypasses RLS) |
| `GROQ_API_KEY` | yes | Groq LLM |
| `TAVILY_API_KEY` | yes | Tavily web search |
| `RESEND_API_KEY` | yes | Resend email alerts |
| `INTERNAL_API_KEY` | **yes** | Shared secret for internal endpoints (see below) |
| `ENABLE_MOCK_REVIEWS` | no | Leave `false` in prod |
| `GROQ_MODEL` | no | Defaults to `llama-3.3-70b-versatile` |
| `ALERT_EMAIL_FALLBACK` | no | Defaults to `onboarding@resend.dev` |
| `YOUTUBE_API_KEY` | no | Enables YouTube video/comment collection |
| `APIFY_TOKEN` | no | Enables configured X/Facebook Apify actors |
| `APIFY_TWITTER_ACTOR` | no | Apify actor id for X/Twitter collection |
| `APIFY_FACEBOOK_ACTOR` | no | Apify actor id for Facebook collection |

### 3. Generate `INTERNAL_API_KEY`
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```
Use the **same value** in Render AND in the GitHub secret (Part 2). If they
don't match, the pipeline gets `401`s. If it's missing on Render, the internal
endpoints return `503` (fail-closed by design).

### 4. Note your backend URL
After the first deploy you'll get a URL like `https://sentiwatch-api.onrender.com`.
You'll need it for the frontend and the GitHub secret.

---

## Part 2 — Set up the hourly pipeline (GitHub Actions)

The workflow lives at `.github/workflows/pipeline.yml`. It runs `cron_sync.py`
every hour: it wakes the Render service, then calls the authenticated
`/sync`, `/analyze`, and `/calculate-risk` endpoints for every entity.

### Add repo secrets
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `BACKEND_URL` | Your Render URL, e.g. `https://sentiwatch-api.onrender.com` |
| `INTERNAL_API_KEY` | Same value you set on Render |
| `SUPABASE_URL` | Same as Render |
| `SUPABASE_KEY` | Same as Render |
| `SUPABASE_SERVICE_ROLE` | Same as Render |

### Test it
Actions tab → **Hourly Reputation Pipeline** → **Run workflow**. Watch the logs:
you should see the warmup ("🌡️ Backend awake"), then per-entity sync/analyze/risk.

> First run after idle is slow: Render cold-starts (~30-50s). The warmup step in
> `cron_sync.py` handles this, but expect the first hit to lag.

---

## Part 3 — Point the frontend at the new backend

On **Vercel** → project → Settings → Environment Variables, update:

- `NEXT_PUBLIC_API_URL` = your Render URL (e.g. `https://sentiwatch-api.onrender.com`)

Redeploy the frontend. Also update Render's CORS if it pins origins (check
`allow_origins` in `backend/main.py`) so your Vercel domain is allowed.

---

## Free-tier behavior to expect

- **Cold starts:** the backend sleeps after ~15 min idle. The first request
  (from a user or the cron) wakes it in ~30-50s. Your frontend's polling loop
  already shows loading states, so this reads as normal warmup.
- **Entity creation** (`POST /entities`) triggers its pipeline via FastAPI
  `BackgroundTasks` on the Render service itself — that still works
  independently of the GitHub cron.

---

## Scheduled pipeline reliability

`cron_sync.py` inventories monitored entities with the Supabase service-role
client so user-scoped RLS cannot hide them. Both Render and GitHub Actions must
have `SUPABASE_SERVICE_ROLE`; privileged backend work now fails clearly when it
is absent instead of silently falling back to the anon client.

Each entity runs through scrape, analysis, and risk calculation sequentially.
The default scrape timeout is 300 seconds, which covers the two synchronous
Apify actor calls. Override `PIPELINE_SYNC_TIMEOUT`,
`PIPELINE_ANALYZE_TIMEOUT`, or `PIPELINE_RISK_TIMEOUT` in the Actions workflow
if provider latency changes. A failed stage stops that entity, continues with
the remaining entities, and makes the workflow fail after reporting totals.
