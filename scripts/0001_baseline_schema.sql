-- Complete baseline schema for a new SentiWatch Supabase project.
-- Existing installations should continue applying the dated migrations in
-- order; this file exists so a fresh environment is reproducible.

begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monitored_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  profile_type text not null default 'business'
    check (profile_type in ('business', 'influencer', 'student', 'real_estate')),
  social_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitor_links (
  id uuid primary key default gen_random_uuid(),
  primary_entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  competitor_entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint competitor_links_not_self check (primary_entity_id <> competitor_entity_id),
  constraint competitor_links_pair_unique unique (primary_entity_id, competitor_entity_id)
);

create table if not exists public.mentions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  source text not null,
  content text not null,
  url text,
  status text check (status is null or status in ('pending', 'processed', 'rejected', 'needs_review')),
  platform text,
  source_post_id text,
  source_comment_id text,
  author_name text,
  author_handle text,
  engagement jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sentiment_results (
  id uuid primary key default gen_random_uuid(),
  mention_id uuid not null unique references public.mentions(id) on delete cascade,
  label text not null check (label in ('positive', 'neutral', 'negative')),
  confidence double precision not null check (confidence between 0 and 1),
  severity integer not null check (severity between 1 and 10),
  category text not null default 'general',
  sub_category text not null default 'general',
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high', 'critical')),
  root_cause text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.risk_scores (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  status text not null check (status in ('healthy', 'watch', 'elevated', 'high', 'critical')),
  negative_mentions integer not null default 0,
  positive_mentions integer not null default 0,
  neutral_mentions integer not null default 0,
  category_breakdown jsonb not null default '{}'::jsonb,
  root_cause_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.monitored_entities(id) on delete cascade,
  risk_score integer not null check (risk_score between 0 and 100),
  trigger_category text not null default 'general',
  action_plan text not null,
  category_breakdown jsonb not null default '{}'::jsonb,
  root_cause_summary text,
  created_at timestamptz not null default now()
);

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

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_alerts_enabled boolean not null default true,
  daily_digest_enabled boolean not null default false,
  last_digest_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

grant select on table public.pipeline_runs to authenticated;
grant select, insert, update on table public.pipeline_runs to service_role;

create unique index if not exists mentions_entity_url_unique
  on public.mentions (entity_id, url) where url is not null and url <> '';
create unique index if not exists mentions_entity_platform_comment_unique
  on public.mentions (entity_id, platform, source_comment_id)
  where source_comment_id is not null and source_comment_id <> '';
create unique index if not exists mentions_entity_platform_post_unique
  on public.mentions (entity_id, platform, source_post_id)
  where source_post_id is not null and source_post_id <> '' and source_comment_id is null;
create index if not exists monitored_entities_user_idx on public.monitored_entities (user_id);
create index if not exists mentions_entity_created_idx on public.mentions (entity_id, created_at desc);
create index if not exists mentions_entity_status_created_idx on public.mentions (entity_id, status, created_at desc);
create index if not exists risk_scores_entity_created_idx on public.risk_scores (entity_id, created_at desc);
create index if not exists recommendations_entity_created_idx on public.recommendations (entity_id, created_at desc);
create index if not exists pipeline_runs_entity_started_idx on public.pipeline_runs (entity_id, started_at desc);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

commit;

-- Apply the dated migrations after this baseline. They install recovery RPCs
-- and the full read-only RLS policy set used by the browser.
