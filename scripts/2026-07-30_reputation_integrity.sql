-- SentiWatch reputation-integrity migration.
-- Run once in the Supabase SQL editor before deploying the matching code.

begin;

-- Mention lifecycle decisions prevent rejected items from consuming LLM quota
-- again on every hourly run.
alter table public.mentions
  add column if not exists status text;

alter table public.mentions
  drop constraint if exists mentions_status_check;

alter table public.mentions
  add constraint mentions_status_check
  check (status is null or status in ('pending', 'processed', 'rejected'));

-- A URL may be relevant to more than one tracked entity. Replace any old
-- URL-only uniqueness rule with entity-scoped identity. Adjust the first drop
-- if your existing constraint has a project-specific name.
alter table public.mentions drop constraint if exists mentions_url_key;
create unique index if not exists mentions_entity_url_unique
  on public.mentions (entity_id, url)
  where url is not null and url <> '';

-- Risk scores are immutable observations. Remove common one-row-per-entity
-- constraints so each calculation becomes a historical snapshot.
alter table public.risk_scores drop constraint if exists risk_scores_entity_id_key;
create index if not exists risk_scores_entity_created_idx
  on public.risk_scores (entity_id, created_at desc);

-- Durable visibility for asynchronous entity-creation pipelines.
create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  stage text not null,
  error_message text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists pipeline_runs_entity_started_idx
  on public.pipeline_runs (entity_id, started_at desc);

alter table public.pipeline_runs enable row level security;

drop policy if exists pipeline_runs_select_own on public.pipeline_runs;
create policy pipeline_runs_select_own
on public.pipeline_runs for select
using (
  exists (
    select 1 from public.monitored_entities e
    where e.id = pipeline_runs.entity_id
      and e.user_id = auth.uid()
  )
);

commit;
