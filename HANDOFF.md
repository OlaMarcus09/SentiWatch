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

## One live database action still required

Two legacy policies were found with `WITH CHECK (true)`:

- `Allow backend to insert mentions`
- `Allow backend to insert sentiment results`

They permit direct browser inserts and are unnecessary because backend
service-role writes bypass RLS. Run the cleanup below in Supabase:

```sql
begin;
drop policy if exists "Allow backend to insert mentions" on public.mentions;
drop policy if exists "Allow backend to insert sentiment results" on public.sentiment_results;
commit;
```

Then verify this returns zero rows:

```sql
select tablename, policyname, with_check
from pg_policies
where schemaname = 'public'
  and cmd = 'INSERT'
  and tablename in ('mentions', 'sentiment_results');
```

The corrected production migration and verification script enforce this for
future environments.

## Deployment sequence after the policy cleanup

1. Commit and push the reviewed production-readiness changes to `origin/main`.
2. Deploy the Render backend and verify `GET /health/ready` returns HTTP 200.
3. Deploy the Vercel frontend with the production Supabase/API variables.
4. Manually run `Hourly Reputation Pipeline` in GitHub Actions.
5. Manually run `Daily Reputation Digest` in GitHub Actions.
6. Test entity creation, competitor creation, notification read actions,
   settings persistence, pipeline recovery, and one complete risk calculation.
7. Configure a verified Resend sending domain instead of relying on
   `onboarding@resend.dev` for real customers.

## Important repository notes

- Do not commit `instance.jpeg` or `issue.jpeg`; they are local screenshots.
- The worktree intentionally contains the production hardening plus previously
  implemented notification, recovery, social-source, and dashboard work.
- No live hosting deployment was performed during the hardening session.
