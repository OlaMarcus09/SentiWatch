-- Durable pipeline leases and structured source metadata.
-- Run once in the Supabase SQL editor before deploying the matching backend.

begin;

alter table public.pipeline_runs
  add column if not exists brand_name text,
  add column if not exists profile_type text,
  add column if not exists social_handle text,
  add column if not exists worker_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 1,
  add column if not exists max_attempts integer not null default 3;

create index if not exists pipeline_runs_recovery_idx
  on public.pipeline_runs (lease_expires_at)
  where status = 'running' and finished_at is null;

-- Existing in-flight rows predate leases. Make them recoverable immediately
-- after deployment rather than leaving them permanently stuck as running.
update public.pipeline_runs
set lease_expires_at = coalesce(updated_at, started_at, now())
where status = 'running'
  and finished_at is null
  and lease_expires_at is null;

-- Do not leave jobs that exhausted their retry budget looking permanently
-- active. They remain visible as failed for operator investigation.
update public.pipeline_runs
set status = 'failed',
    stage = 'failed',
    error_message = coalesce(error_message, 'Pipeline retry limit exhausted'),
    finished_at = coalesce(finished_at, now()),
    updated_at = now(),
    lease_expires_at = null
where status = 'running'
  and finished_at is null
  and attempt_count >= max_attempts
  and lease_expires_at < now();

alter table public.mentions
  add column if not exists platform text,
  add column if not exists source_post_id text,
  add column if not exists source_comment_id text,
  add column if not exists author_name text,
  add column if not exists author_handle text,
  add column if not exists engagement jsonb not null default '{}'::jsonb,
  add column if not exists published_at timestamptz,
  add column if not exists raw_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists mentions_entity_platform_comment_unique
  on public.mentions (entity_id, platform, source_comment_id)
  where source_comment_id is not null and source_comment_id <> '';

create unique index if not exists mentions_entity_platform_post_unique
  on public.mentions (entity_id, platform, source_post_id)
  where source_post_id is not null and source_post_id <> ''
    and source_comment_id is null;

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
  set status = 'failed',
      stage = 'failed',
      error_message = coalesce(error_message, 'Pipeline retry limit exhausted'),
      finished_at = now(),
      updated_at = now(),
      lease_expires_at = null
  where status = 'running'
    and finished_at is null
    and attempt_count >= max_attempts
    and lease_expires_at < now();

  return query
  with candidates as (
    select id
    from public.pipeline_runs
    where status = 'running'
      and finished_at is null
      and lease_expires_at is not null
      and lease_expires_at < now()
      and attempt_count < max_attempts
    order by lease_expires_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.pipeline_runs pr
  set worker_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(60, coalesce(p_lease_seconds, 900))),
      attempt_count = pr.attempt_count + 1,
      stage = 'recovering',
      error_message = null,
      updated_at = now()
  from candidates c
  where pr.id = c.id
  returning pr.*;
end;
$$;

revoke all on function public.claim_recoverable_pipeline_runs(integer, integer) from public;
grant execute on function public.claim_recoverable_pipeline_runs(integer, integer) to service_role;

commit;
