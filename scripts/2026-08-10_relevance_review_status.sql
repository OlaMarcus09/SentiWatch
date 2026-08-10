-- Preserve relevance-gate failures for manual review instead of silently
-- admitting them to sentiment scoring.
begin;

alter table public.mentions
  drop constraint if exists mentions_status_check;

alter table public.mentions
  add constraint mentions_status_check
  check (status is null or status in ('pending', 'processed', 'rejected', 'needs_review'));

create index if not exists mentions_entity_status_created_idx
  on public.mentions (entity_id, status, created_at desc);

commit;
