# SentiWatch Deployment (Render + GitHub Actions)

Before deploying the reputation-integrity update, run
`scripts/2026-07-30_reputation_integrity.sql` once in the Supabase SQL editor.
It enables entity-scoped mention deduplication, risk-score history, and durable
background-pipeline status reporting.

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

## Known follow-up (not blocking deploy)

`cron_sync.py` lists entities with the **anon** Supabase client
(`from database import supabase`). If RLS on `monitored_entities` restricts
`select` to `auth.uid()`, an unauthenticated anon query may return **zero rows**,
so the cron would find nothing to process. If you see "No monitored entities
found" despite having data, switch that query to the admin client
(`supabase_admin`) or add a service-role read path. Verify against your actual
RLS policies (see `SECURITY.md` §4).
