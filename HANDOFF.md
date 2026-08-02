# SentiWatch Handoff

Last updated: 2026-08-02

## Current state

The repository has completed a production-readiness hardening pass covering
scoring correctness, ingestion deduplication, bounded queries, tenant security,
cost controls, durable scheduled processing, reproducible schema setup,
notifications, deployment checks, and browser/API security headers.

Local verification is green:

- 12 backend integrity tests pass.
- Python compilation passes.
- Frontend ESLint passes.
- Next.js production build and TypeScript pass.
- `git diff --check` passes.

The live Supabase project has passed these database checks:

- RLS enabled on all 10 tenant tables.
- All seven expected production indexes are present.
- No orphaned mention, risk-score, or recommendation records.
- Ownership SELECT policies correctly scope rows through `auth.uid()`.

## Completed live database cleanup

The two legacy policies previously found with `WITH CHECK (true)` were removed
from the live Supabase project:

- `Allow backend to insert mentions`
- `Allow backend to insert sentiment results`

They permitted direct browser inserts and were unnecessary because backend
service-role writes bypass RLS. The cleanup was applied and the INSERT-policy
verification returned zero rows.

The corrected production migration and verification script enforce this for
future environments.

## Remaining deployment sequence

The reviewed production-readiness changes are pushed to `origin/main` at
commit `06419c9`.

1. Deploy the Render backend and verify `GET /health/ready` returns HTTP 200.
2. Deploy the Vercel frontend with the production Supabase/API variables.
3. Manually run `Hourly Reputation Pipeline` in GitHub Actions.
4. Manually run `Daily Reputation Digest` in GitHub Actions.
5. Test entity creation, competitor creation, notification read actions,
   settings persistence, pipeline recovery, and one complete risk calculation.
6. Configure a verified Resend sending domain instead of relying on
   `onboarding@resend.dev` for real customers.

## Important repository notes

- Do not commit `instance.jpeg` or `issue.jpeg`; they are local screenshots.
- The worktree intentionally contains the production hardening plus previously
  implemented notification, recovery, social-source, and dashboard work.
- No live hosting deployment was performed during the hardening session.
