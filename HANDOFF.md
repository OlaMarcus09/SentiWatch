# SentiWatch Handoff

Last updated: 2026-08-03

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

## Current handoff

The latest reliability fix is pushed to `origin/main` at commit `3d37e3c`.
The product direction and active backlog are maintained in
[`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

1. Deploy the latest `3d37e3c` backend/workflow changes and run the pipeline once.
2. Confirm the one-time `pipeline_runs` grants from
   `scripts/2026-08-03_pipeline_runtime_grants.sql` are applied.
3. Build the Data Trust Center and evidence-backed mention drawer (roadmap Now).
4. Then implement competitor share-of-voice and historical comparisons.
5. Configure a verified Resend sending domain instead of relying on
   `onboarding@resend.dev` for real customers.

## Important repository notes

- Do not commit `instance.jpeg` or `issue.jpeg`; they are local screenshots.
- The worktree intentionally contains the production hardening plus previously
  implemented notification, recovery, social-source, and dashboard work.
- No live hosting deployment was performed during the hardening session.
