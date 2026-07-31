# SentiWatch Architecture

SentiWatch is a multi-tenant reputation monitoring application. It collects public mentions for a tracked entity, classifies those mentions with an LLM, converts the classifications into a 0–100 reputation-risk score, and presents an urgency-oriented dashboard with recommendations, competitor comparisons, and alerts.

This document describes the architecture currently implemented in the repository and the hardening work that should come next.

## System at a glance

```text
User browser
   |
   | Supabase Auth session + anon-key reads (RLS)
   v
Vercel / Next.js frontend
   |
   | authenticated POST /entities
   v
Render / FastAPI backend --------------------+
   |                                         |
   | service-role writes                     | Tavily search
   |                                         | Groq or AgentRouter LLM
   v                                         | Resend email
Supabase Postgres <--------------------------+
   ^
   |
GitHub Actions hourly cron
   | X-Internal-Key
   +--> /sync -> /analyze -> /calculate-risk
```

The frontend reads most dashboard data directly from Supabase using the authenticated user's session. The backend uses the Supabase service-role client for system writes and background processing, so backend routes must enforce authorization explicitly wherever they act on behalf of a user.

## Repository structure

| Area | Responsibility |
| --- | --- |
| `backend/main.py` | FastAPI app, auth dependencies, entity/competitor creation, pipeline orchestration, internal endpoints |
| `backend/scrapers.py` | Source adapters and entity-scoped mention insertion/deduplication |
| `backend/sentiment.py` | Mention lifecycle, relevance filtering, LLM sentiment classification, output validation |
| `backend/scoring.py` | Pure scoring functions: sentiment, severity, confidence, source/category/risk weights, recency, volume, normalization |
| `backend/risk_engine.py` | Entity aggregation, historical risk-score persistence, recommendations, email alerts |
| `backend/services/search_service.py` | Persona-aware Tavily web context retrieval |
| `backend/services/llm_client.py` | Provider abstraction and retrying JSON LLM calls (Groq fallback, optional AgentRouter) |
| `backend/cron_sync.py` | Hourly machine-to-machine orchestration |
| `frontend/src/app` | Next.js routes and authenticated application screens |
| `frontend/src/components/providers/DashboardProvider.tsx` | Session bootstrap, entity selection, competitor loading, pipeline polling, dashboard state |
| `scripts/2026-07-30_reputation_integrity.sql` | Required database migration for deduplication, score history, and pipeline status |
| `.github/workflows/pipeline.yml` | Hourly scheduled pipeline and backend integrity tests |
| `DEPLOY.md` / `SECURITY.md` | Deployment and security operating procedures |

## Core data model

The database is Supabase Postgres. The application relies on these tables:

- `users`: application profile keyed to Supabase Auth user IDs.
- `monitored_entities`: primary brands/profiles and competitor entities. Each row has an owner (`user_id`), name, profile type, and optional social handle.
- `competitor_links`: links a user's primary entity to competitor entity rows.
- `mentions`: raw source observations. Mentions are entity-scoped and deduplicated by `(entity_id, url)` when a URL exists. `status` is `pending`, `processed`, or `rejected`.
- `sentiment_results`: structured LLM output associated with a mention.
- `risk_scores`: immutable score snapshots, not a single mutable score per entity.
- `recommendations`: generated action plans associated with a score/calculation.
- `pipeline_runs`: durable progress records for asynchronous entity analysis (`running`, `completed`, `failed`) with stage and timestamps.

Foreign keys should cascade children when an entity is deleted. The `pipeline_runs` migration enables RLS and scopes reads through the owning entity.

## Request and processing flows

### 1. Entity creation

1. The browser obtains a Supabase JWT.
2. `POST /entities` validates the JWT with `supabase_admin.auth.get_user`.
3. The backend upserts the user's profile and creates the primary entity with `user_id` set to the authenticated user.
4. Optional competitors are created as owned entities and linked through `competitor_links`.
5. FastAPI `BackgroundTasks` starts one analysis pipeline for the primary entity and each competitor.
6. The browser polls `pipeline_runs` and `risk_scores` until the first result is available or the run fails.

### 2. Analysis pipeline

`run_analysis_pipeline` records progress through these stages:

1. `starting`
2. `collecting_mentions`: news, social, YouTube, Twitter, and Facebook adapters (some are environment-gated no-ops).
3. `searching_web`: persona-specific Tavily query and live context snapshot.
4. `analyzing_sentiment`: relevance gate, LLM classification, validation, and mention status updates.
5. `calculating_risk`: aggregation, historical score insert, recommendation generation, and email alert evaluation.
6. `completed` or `failed` with a bounded error message.

Blocking scraper, database, and email work is moved to worker threads from the async pipeline so it does not block FastAPI's event loop.

### 3. Hourly refresh

GitHub Actions installs backend dependencies, runs the integrity tests, warms the Render service, then invokes the internal endpoints for every entity:

```text
/sync/{entity_id} -> /analyze?entity_id=... -> /calculate-risk/{entity_id}
```

Each call requires `X-Internal-Key`. The current cron entity listing uses the anon Supabase client; this must be validated against production RLS or changed to a controlled service-role listing path.

## Authentication and tenancy

There are two authentication classes:

- User routes use Supabase JWTs (`Authorization: Bearer ...`). The backend must perform ownership checks whenever it uses the service-role client.
- Internal routes use `INTERNAL_API_KEY` and constant-time comparison. Missing configuration fails closed with HTTP 503.

The browser's anon-key reads are safe only if RLS is enabled and correctly written for every table. Expected policies scope entities to `auth.uid()` and scope child rows through their parent entity. See `SECURITY.md` for verification SQL.

## External integrations

- Supabase Auth/Postgres: identity, persistence, and browser reads.
- Tavily: live web context, selected by profile type.
- Groq: default LLM provider.
- AgentRouter/OpenAI-compatible endpoint: optional provider selected by environment configuration.
- Resend: threshold-triggered email alerts.
- Render: FastAPI hosting; free-tier cold starts are expected.
- Vercel: Next.js frontend hosting.
- GitHub Actions: hourly orchestration and integrity test gate.

All provider calls are environment-configured. LLM calls request JSON, retry up to three times, and have application-level fallback behavior for recommendations.

## Scoring and recommendation contract

Each analyzed mention contributes a signed score based on sentiment, severity, confidence, source credibility, category, AI risk level, and recency. Negative sentiment increases risk; positive sentiment reduces it. Volume multipliers and normalization produce the final 0–100 score and status (`healthy`, `watch`, `elevated`, `high`, or `critical`).

Risk calculation persists the score snapshot, then asks the LLM for 3–5 prioritized recommendations. If that call fails, a deterministic persona-specific playbook is stored instead. Email delivery is a side effect and does not replace persistence of the score or recommendation.

## Reliability characteristics

Already implemented:

- Entity-scoped mention deduplication.
- Mention lifecycle statuses prevent repeatedly spending LLM quota on rejected items.
- Historical risk-score snapshots.
- Durable pipeline progress visible to the frontend.
- LLM retries and recommendation fallback.
- Hard-negative sentiment backstop and integrity tests.
- Render cold-start warmup in the scheduled job.
- Concurrency protection for overlapping GitHub Actions runs.

Current limitations:

- FastAPI `BackgroundTasks` are in-process and can be interrupted by a Render restart or deploy; `pipeline_runs` records state but does not resume work.
- `/sync`, `/analyze`, and `/calculate-risk` trust possession of the shared internal key and do not independently verify entity ownership.
- The cron's anon entity listing can return zero rows under strict RLS.
- No application-level rate limiting, circuit breaker, or provider quota budget is implemented.
- Database migrations are applied manually; deployment does not yet validate schema compatibility automatically.
- Source adapters vary in completeness and freshness; several are intentionally disabled until provider credentials exist.
- CORS contains a fixed production origin and must be updated when the frontend domain changes.

## Next hardening sequence

1. **Verify and lock down Supabase RLS in production.** Confirm RLS is enabled on all tenant tables and test cross-user reads/writes, especially `competitor_links`, `pipeline_runs`, and child tables.
2. **Fix cron tenancy.** Use a service-role read path for the scheduled entity inventory, or create a narrowly scoped backend endpoint that returns only processable entities. Do not depend on an unauthenticated anon query under user-scoped RLS.
3. **Make pipeline execution durable.** Move long-running analysis to a queue/worker or resumable job table with leases, idempotency keys, retries, and stale-run recovery. Keep `pipeline_runs` as the user-visible status projection.
4. **Add rate limits and operational telemetry.** Protect JWT and internal routes, record provider latency/error counts, and alert on repeated failed runs or quota exhaustion.
5. **Automate schema and dependency checks.** Run migrations in a controlled release step and add `pip-audit`, `npm audit`, and type/lint checks to CI.
6. **Expand source coverage safely.** Replace mock/disabled adapters with credentialed integrations, normalize source metadata, and add fixture-based scraper tests.
7. **Improve product correctness.** Add pagination, per-entity refresh controls, explicit stale-data indicators, and tests for score trends, competitor isolation, and alert deduplication.

## Definition of “strong”

SentiWatch is ready for broader production use when a tenant cannot access another tenant's data, a failed deployment cannot lose an analysis job, scheduled processing is observable and resumable, provider failures degrade gracefully, schema changes are reproducible, and the scoring/recommendation outputs are covered by deterministic tests plus representative source fixtures.

## Operational references

- Deployment: [`DEPLOY.md`](DEPLOY.md)
- Security and RLS checklist: [`SECURITY.md`](SECURITY.md)
- Integrity migration: [`scripts/2026-07-30_reputation_integrity.sql`](scripts/2026-07-30_reputation_integrity.sql)
- Backend integrity tests: [`backend/tests/test_reputation_integrity.py`](backend/tests/test_reputation_integrity.py)
