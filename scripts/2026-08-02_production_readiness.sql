-- Production-readiness hardening for existing SentiWatch databases.
-- Apply after the 2026-07-31 migrations. This migration is intentionally
-- idempotent and focuses on tenant isolation, query indexes, and data shape.

begin;

-- Older installations may not have applied the source-metadata and delivery
-- migrations yet. Create the referenced columns/table before indexes/policies.
alter table public.mentions
  add column if not exists status text,
  add column if not exists platform text,
  add column if not exists source_post_id text,
  add column if not exists source_comment_id text,
  add column if not exists author_name text,
  add column if not exists author_handle text,
  add column if not exists engagement jsonb not null default '{}'::jsonb,
  add column if not exists published_at timestamptz,
  add column if not exists raw_metadata jsonb not null default '{}'::jsonb;

create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  stage text not null,
  error_message text,
  brand_name text,
  profile_type text,
  social_handle text,
  worker_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1,
  max_attempts integer not null default 3,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.pipeline_runs
  add column if not exists brand_name text,
  add column if not exists profile_type text,
  add column if not exists social_handle text,
  add column if not exists worker_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 1,
  add column if not exists max_attempts integer not null default 3;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_alerts_enabled boolean not null default true,
  daily_digest_enabled boolean not null default false,
  last_digest_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences
  add column if not exists last_digest_sent_at timestamptz;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid references public.monitored_entities(id) on delete cascade,
  event_type text not null check (event_type in ('risk_threshold', 'risk_escalation')),
  title text not null,
  message text not null,
  risk_score integer,
  risk_status text,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.claim_recoverable_pipeline_runs(
  p_limit integer default 10,
  p_lease_seconds integer default 900
)
returns setof public.pipeline_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pipeline_runs
  set status = 'failed', stage = 'failed',
      error_message = coalesce(error_message, 'Pipeline retry limit exhausted'),
      finished_at = now(), updated_at = now(), lease_expires_at = null
  where status = 'running' and finished_at is null
    and attempt_count >= max_attempts and lease_expires_at < now();

  return query
  with candidates as (
    select id from public.pipeline_runs
    where status = 'running' and finished_at is null
      and lease_expires_at is not null and lease_expires_at < now()
      and attempt_count < max_attempts
    order by lease_expires_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.pipeline_runs run
  set worker_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(60, coalesce(p_lease_seconds, 900))),
      attempt_count = run.attempt_count + 1,
      stage = 'recovering', error_message = null, updated_at = now()
  from candidates candidate
  where run.id = candidate.id
  returning run.*;
end;
$$;

revoke all on function public.claim_recoverable_pipeline_runs(integer, integer) from public;
grant execute on function public.claim_recoverable_pipeline_runs(integer, integer) to service_role;

-- Required ownership and lifecycle indexes for the browser's RLS reads and
-- the backend's bounded scheduled queries.
create index if not exists monitored_entities_user_idx
  on public.monitored_entities (user_id);
create index if not exists mentions_entity_created_idx
  on public.mentions (entity_id, created_at desc);
create index if not exists mentions_entity_status_created_idx
  on public.mentions (entity_id, status, created_at desc);
create index if not exists sentiment_results_mention_idx
  on public.sentiment_results (mention_id);
create index if not exists recommendations_entity_created_idx
  on public.recommendations (entity_id, created_at desc);
create index if not exists competitor_links_primary_idx
  on public.competitor_links (primary_entity_id);
create index if not exists pipeline_runs_recovery_idx
  on public.pipeline_runs (lease_expires_at)
  where status = 'running' and finished_at is null;

-- One daily Tavily snapshot per entity. The application uses a stable
-- source_post_id (tavily:YYYY-MM-DD), preventing hourly volume inflation.
with duplicate_tavily_rows as (
  select id,
         row_number() over (
           partition by entity_id, source_post_id
           order by created_at asc, id asc
         ) as row_number
  from public.mentions
  where platform = 'tavily' and source_post_id is not null
)
delete from public.mentions mention
using duplicate_tavily_rows duplicate
where mention.id = duplicate.id
  and duplicate.row_number > 1;

create unique index if not exists mentions_entity_tavily_snapshot_unique
  on public.mentions (entity_id, source_post_id)
  where platform = 'tavily' and source_post_id is not null;

-- Tenant tables must fail closed for browser access.
alter table public.users enable row level security;
alter table public.monitored_entities enable row level security;
alter table public.competitor_links enable row level security;
alter table public.mentions enable row level security;
alter table public.sentiment_results enable row level security;
alter table public.risk_scores enable row level security;
alter table public.recommendations enable row level security;
alter table public.pipeline_runs enable row level security;

grant select on table public.pipeline_runs to authenticated;
grant select, insert, update on table public.pipeline_runs to service_role;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

-- These legacy policies used WITH CHECK (true), which grants any browser
-- holding the anon key direct insert access. Backend writes use service_role
-- and bypass RLS, so no public insert policy is required.
drop policy if exists "Allow backend to insert mentions" on public.mentions;
drop policy if exists "Allow backend to insert sentiment results" on public.sentiment_results;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users for select
using (id = auth.uid());

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users for update
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists entities_select_own on public.monitored_entities;
create policy entities_select_own on public.monitored_entities for select
using (user_id = auth.uid());

drop policy if exists competitor_links_select_own on public.competitor_links;
create policy competitor_links_select_own on public.competitor_links for select
using (
  exists (
    select 1 from public.monitored_entities entity
    where entity.id = competitor_links.primary_entity_id
      and entity.user_id = auth.uid()
  )
);

drop policy if exists mentions_select_own on public.mentions;
create policy mentions_select_own on public.mentions for select
using (
  exists (
    select 1 from public.monitored_entities entity
    where entity.id = mentions.entity_id
      and entity.user_id = auth.uid()
  )
);

drop policy if exists sentiment_results_select_own on public.sentiment_results;
create policy sentiment_results_select_own on public.sentiment_results for select
using (
  exists (
    select 1
    from public.mentions mention
    join public.monitored_entities entity on entity.id = mention.entity_id
    where mention.id = sentiment_results.mention_id
      and entity.user_id = auth.uid()
  )
);

drop policy if exists risk_scores_select_own on public.risk_scores;
create policy risk_scores_select_own on public.risk_scores for select
using (
  exists (
    select 1 from public.monitored_entities entity
    where entity.id = risk_scores.entity_id
      and entity.user_id = auth.uid()
  )
);

drop policy if exists recommendations_select_own on public.recommendations;
create policy recommendations_select_own on public.recommendations for select
using (
  exists (
    select 1 from public.monitored_entities entity
    where entity.id = recommendations.entity_id
      and entity.user_id = auth.uid()
  )
);

drop policy if exists pipeline_runs_select_own on public.pipeline_runs;
create policy pipeline_runs_select_own on public.pipeline_runs for select
using (
  exists (
    select 1 from public.monitored_entities entity
    where entity.id = pipeline_runs.entity_id
      and entity.user_id = auth.uid()
  )
);

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
on public.notification_preferences for select using (user_id = auth.uid());

drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own
on public.notification_preferences for insert with check (user_id = auth.uid());

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own
on public.notification_preferences for update
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
using (user_id = auth.uid());

commit;
