-- Persistence foundation for autonomous crisis-response investigations.
-- Agent execution is intentionally not included in this migration.
begin;

-- PostgreSQL requires a unique key covering every referenced FK column.
-- The risk score id is already globally unique, but this composite index lets
-- the database also enforce that the snapshot and brief share one entity.
create unique index if not exists risk_scores_id_entity_unique_idx
  on public.risk_scores (id, entity_id);

create table if not exists public.crisis_briefs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  risk_snapshot_id uuid not null,
  event_key text not null,
  event_type text not null check (event_type in ('risk_threshold', 'risk_escalation')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  incident_title text not null,
  summary text,
  severity text not null check (severity in ('high', 'critical')),
  root_cause_hypothesis text,
  evidence_summary text,
  recommended_actions jsonb not null default '[]'::jsonb,
  draft_public_response text,
  confidence double precision check (confidence is null or confidence between 0 and 1),
  citations jsonb not null default '[]'::jsonb,
  error_message text,
  error_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Drop the original single-column FK when upgrading an environment where the
-- first version of this migration was already applied, then install the
-- tenant-consistent composite relationship.
alter table public.crisis_briefs
  drop constraint if exists crisis_briefs_risk_snapshot_id_fkey,
  drop constraint if exists crisis_briefs_risk_snapshot_entity_fkey;

alter table public.crisis_briefs
  add constraint crisis_briefs_risk_snapshot_entity_fkey
  foreign key (risk_snapshot_id, entity_id)
  references public.risk_scores (id, entity_id)
  on delete cascade;

create index if not exists crisis_briefs_entity_created_idx
  on public.crisis_briefs (entity_id, created_at desc);
create unique index if not exists crisis_briefs_event_key_idx
  on public.crisis_briefs (event_key);
create index if not exists crisis_briefs_status_idx
  on public.crisis_briefs (status);
create index if not exists crisis_briefs_created_idx
  on public.crisis_briefs (created_at desc);

alter table public.crisis_briefs enable row level security;

grant select on table public.crisis_briefs to authenticated;
grant select, insert, update on table public.crisis_briefs to service_role;

drop policy if exists crisis_briefs_select_own on public.crisis_briefs;
create policy crisis_briefs_select_own on public.crisis_briefs for select
using (
  exists (
    select 1 from public.monitored_entities entity
    where entity.id = crisis_briefs.entity_id
      and entity.user_id = auth.uid()
  )
);

-- Authenticated browser clients receive no INSERT/UPDATE/DELETE policy.
-- Privileged lifecycle changes remain backend-only through service_role.

commit;
