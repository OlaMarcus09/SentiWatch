-- Backend correctness hardening. Run after the reputation-integrity migration.
begin;

-- Recommendation dismissal is performed by the authenticated backend endpoint
-- (which verifies entity ownership explicitly). Keep read access for the UI;
-- direct client writes are intentionally not required.
alter table public.recommendations enable row level security;

drop policy if exists recommendations_select_own on public.recommendations;
create policy recommendations_select_own
on public.recommendations for select
using (
  exists (
    select 1 from public.monitored_entities e
    where e.id = recommendations.entity_id
      and e.user_id = auth.uid()
  )
);

-- Prevent repeated competitor links for the same entity pair. Existing
-- duplicates should be cleaned before applying this index if Supabase reports
-- a conflict.
create unique index if not exists competitor_links_pair_unique
  on public.competitor_links (primary_entity_id, competitor_entity_id);

commit;
