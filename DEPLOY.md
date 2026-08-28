# SentiWatch Deployment: Google Cloud Run

This is the recommended deployment path for the FastAPI backend. Supabase,
Vercel, Groq, Gemini, Tavily, Resend, and the hourly GitHub Actions orchestrator
remain separate services. The existing `render.yaml` remains available as the
rollback target.

## Production release gate

For a new Supabase project, apply `scripts/0001_baseline_schema.sql`, followed
by every dated migration in filename order. Confirm that
`scripts/2026-08-28_crisis_briefs.sql` has been applied, including the composite
risk snapshot/entity foreign key, RLS policy, indexes, and service-role grants.
Run `scripts/verify_production_schema.sql` and require zero integrity-error rows.

Do not run database migrations from the application container or Cloud Run
startup command.

## 1. Google Cloud project

Select a project and enable the required services:

```bash
gcloud config set project "${PROJECT_ID}"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com
```

Create an Artifact Registry repository in `europe-west1`:

```bash
gcloud artifacts repositories create sentiwatch \
  --repository-format=docker \
  --location=europe-west1 \
  --description="SentiWatch backend images"
```

Create a dedicated Cloud Run service account and grant it access only to the
Secret Manager secrets listed below. Do not use owner/editor credentials as the
runtime identity.

## 2. Secrets and configuration

Create secret values in Google Secret Manager. Do not place secret values in
the Dockerfile, repository, deployment guide, Cloud Build arguments, or frontend
configuration.

Required Secret Manager secrets:

| Name | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE` | Privileged backend database operations |
| `INTERNAL_API_KEY` | `X-Internal-Key` authentication for internal routes |
| `GOOGLE_API_KEY` | Gemini crisis agent |
| `GROQ_API_KEY` | Existing sentiment and recommendation provider |
| `TAVILY_API_KEY` | Web context search |
| `RESEND_API_KEY` | Email alerts and digests |

Optional sensitive secrets:

| Name | Purpose |
| --- | --- |
| `AGENTROUTER_API_KEY` | Optional OpenAI-compatible provider credential |
| `APIFY_TOKEN` | Optional X/Facebook actors |
| `YOUTUBE_API_KEY` | Optional YouTube ingestion |
| `ALERT_EMAIL_FALLBACK` | Optional alert recipient when treated as sensitive |

Required normal environment configuration:

| Name | Recommended value |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase anon/publishable key |
| `ALLOWED_ORIGINS` | Exact comma-separated Vercel and custom-domain origins |
| `CRISIS_AGENT_MODEL` | `gemini-3.5-flash` |
| `CRISIS_AGENT_TIMEOUT_SECONDS` | `45` |
| `CRISIS_AGENT_EVIDENCE_LIMIT` | `20` |

Cloud Run manages `PORT`. Do not configure or hardcode it. The container starts
one Uvicorn worker and reads the injected value at runtime.

Existing optional/tuning configuration:

| Name | Default or purpose |
| --- | --- |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| `RELEVANCE_MODEL` | Defaults to `GROQ_MODEL` |
| `SENTIMENT_MODEL` | Defaults to `GROQ_MODEL` |
| `RECOMMENDATION_MODEL` | Defaults to `GROQ_MODEL` |
| `AGENTROUTER_BASE_URL` | Optional provider base URL |
| `LLM_MAX_RETRIES` | `3` |
| `LLM_REQUEST_TIMEOUT` | `15` seconds |
| `LLM_BACKOFF_BASE_SECONDS` | `1` second |
| `SENTIMENT_BATCH_LIMIT` | `2` |
| `SCORING_WINDOW_DAYS` | `90` |
| `MAX_SCORING_MENTIONS` | `500` |
| `ALERT_COOLDOWN_HOURS` | `6` |
| `PIPELINE_LEASE_SECONDS` | `900` |
| `MAX_ENTITIES_PER_USER` | `10` |
| `MAX_COMPETITORS_PER_ENTITY` | `3` |
| `USER_MUTATION_LIMIT_PER_MINUTE` | `10` |
| `APIFY_TWITTER_ACTOR` | Optional actor ID |
| `APIFY_FACEBOOK_ACTOR` | Optional actor ID |
| `ENABLE_MOCK_REVIEWS` | Keep `false` in production |

## 3. Build the container

Build from the backend directory so the repository frontend and local artifacts
never enter the image context:

```bash
IMAGE="europe-west1-docker.pkg.dev/${PROJECT_ID}/sentiwatch/backend:${IMAGE_TAG}"
gcloud builds submit backend --tag "${IMAGE}"
```

The image uses `python:3.13-slim`, installs `backend/requirements.txt`, runs as
numeric non-root user `10001`, and starts `main:app` from `/app`.

## 4. Deploy Cloud Run

Deploy the built image with this service shape:

```bash
gcloud run deploy sentiwatch-api \
  --image "${IMAGE}" \
  --region europe-west1 \
  --platform managed \
  --service-account "sentiwatch-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --ingress all \
  --cpu 1 \
  --memory 1Gi \
  --concurrency 4 \
  --timeout 360s \
  --min-instances 0 \
  --max-instances 1 \
  --cpu-throttling \
  --set-secrets "SUPABASE_SERVICE_ROLE=SUPABASE_SERVICE_ROLE:latest,INTERNAL_API_KEY=INTERNAL_API_KEY:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest,GROQ_API_KEY=GROQ_API_KEY:latest,TAVILY_API_KEY=TAVILY_API_KEY:latest,RESEND_API_KEY=RESEND_API_KEY:latest" \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL},SUPABASE_KEY=${SUPABASE_KEY},ALLOWED_ORIGINS=${ALLOWED_ORIGINS},CRISIS_AGENT_MODEL=gemini-3.5-flash,CRISIS_AGENT_TIMEOUT_SECONDS=45,CRISIS_AGENT_EVIDENCE_LIMIT=20,ENABLE_MOCK_REVIEWS=false"
```

Configure the Cloud Run startup probe as HTTP `GET /`. Use `GET /health/ready`
as the post-deployment readiness check. The readiness endpoint validates required
configuration and Supabase connectivity but does not call Gemini.

The recommended hackathon configuration is:

| Setting | Value |
| --- | --- |
| Region | `europe-west1` |
| CPU | `1` |
| Memory | `1 GiB` |
| Concurrency | `4` |
| Request timeout | `360 seconds` |
| Minimum instances | `0` |
| Maximum instances | `1` |
| CPU allocation | Request-based |
| Ingress | Public HTTPS |
| Startup probe | `GET /` |
| Readiness | `GET /health/ready` |

Public ingress is required because the Vercel frontend calls the API. User routes
continue to require Supabase JWTs, and machine routes continue to require the
constant-time-checked `X-Internal-Key` header.

## 5. Validate the revision

Get the service URL and test health:

```bash
BACKEND_URL="$(gcloud run services describe sentiwatch-api \
  --region europe-west1 \
  --format='value(status.url)')"

curl --fail --show-error "${BACKEND_URL}/"
curl --fail --show-error "${BACKEND_URL}/health/ready"
```

Then manually dispatch the hourly workflow and confirm this order in its logs:

```text
sync -> analyze -> calculate-risk -> process-crisis
```

## 6. GitHub Actions and Vercel

No workflow code change is required. Set the existing GitHub Actions
`BACKEND_URL` secret to the Cloud Run service URL. Keep the existing
`INTERNAL_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, and
`SUPABASE_SERVICE_ROLE` secrets because `cron_sync.py` authenticates internal
requests and inventories entities.

`GOOGLE_API_KEY` must not be placed in GitHub Actions. Gemini executes inside
the Cloud Run backend only.

Set Vercel `NEXT_PUBLIC_API_URL` to the Cloud Run URL and redeploy the frontend.
No backend credentials or provider API keys belong in frontend variables.

## 7. Operational notes

The scheduled pipeline and crisis agent run inside active HTTP requests and are
compatible with request-based CPU allocation. User-triggered FastAPI
`BackgroundTasks` remain in-process and can be interrupted by scale-to-zero,
revision replacement, or instance shutdown. Existing database leases and the
hourly recovery endpoint limit permanent loss, but this is not a durable queue.

With minimum instances set to zero, expect cold starts. The hourly workflow
already warms `/health/ready` before processing. Maximum instances is limited to
one because mutation throttles and scheduling locks are currently process-local.

## 8. Render rollback

Do not remove `render.yaml` or delete the Render service. To roll back:

```text
Cloud Run issue
  -> restore GitHub BACKEND_URL to the Render service URL
  -> restore Vercel NEXT_PUBLIC_API_URL to the Render service URL
  -> redeploy the frontend
  -> Render resumes the backend role
```

Ensure Render has the same required runtime secrets, including
`GOOGLE_API_KEY`, before using it as the crisis-agent fallback. Point the hourly
workflow at only one backend target at a time.
