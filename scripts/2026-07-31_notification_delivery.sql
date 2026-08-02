-- In-app notification inbox and daily digest delivery state.
begin;

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

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_entity_event_idx
  on public.notifications (entity_id, event_type, risk_status, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
using (user_id = auth.uid());
-- Read state is changed through the authenticated backend endpoint. Do not
-- grant direct table updates, which would also allow clients to forge alert
-- titles, scores, event types, and metadata.
drop policy if exists notifications_update_own on public.notifications;

alter table public.notification_preferences
  add column if not exists last_digest_sent_at timestamptz;

commit;
