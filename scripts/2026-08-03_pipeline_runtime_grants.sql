-- Runtime privileges for tables created after the original Supabase project.
-- RLS still controls browser reads; service_role bypasses RLS for scheduled
-- and backend lifecycle work but also requires PostgreSQL table privileges.

begin;

grant select on table public.pipeline_runs to authenticated;
grant select, insert, update on table public.pipeline_runs to service_role;

commit;
