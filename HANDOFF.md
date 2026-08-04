# SentiWatch Handoff

Last updated: 2026-08-04

## Current state

The repository has completed a production-readiness hardening pass covering
scoring correctness, ingestion deduplication, bounded queries, tenant security,
cost controls, durable scheduled processing, reproducible schema setup,
notifications, deployment checks, and browser/API security headers.

Local verification is green for the current competitive-intelligence slice:

- 20 backend integrity tests pass.
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

The Data Trust and evidence workflow is pushed to `origin/main` at commit
`705ab69`. The current worktree adds the next roadmap slice: authenticated
7/30/90-day competitive intelligence with share of voice, positive/negative
share, mention and risk trends, source/category comparisons, partial-evidence
states, and mention-level drill-downs.
The product direction and active backlog are maintained in
[`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

1. Commit and push the competitive-intelligence slice after final build checks.
2. Deploy the latest backend/frontend changes and run the pipeline once.
3. Confirm the one-time `pipeline_runs` grants from
   `scripts/2026-08-03_pipeline_runtime_grants.sql` are applied.
4. Smoke-test the Data Trust Center, evidence drawer,
   source freshness, and manual analysis control.
5. Smoke-test competitive window switching, evidence states, metric drill-downs,
   and mobile layouts.
6. Start durable incident ownership and response workflow (roadmap Then).
7. Configure a verified Resend sending domain instead of relying on
   `onboarding@resend.dev` for real customers.

## Important repository notes

- Do not commit `instance.jpeg` or `issue.jpeg`; they are local screenshots.
- The worktree intentionally contains the production hardening plus previously
  implemented notification, recovery, social-source, and dashboard work.
- No live hosting deployment was performed during the hardening session.
