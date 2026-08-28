-- Read-only production gate. Every query should return the expected result
-- before a release is considered complete.

select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'users', 'monitored_entities', 'competitor_links', 'mentions',
    'sentiment_results', 'risk_scores', 'recommendations', 'pipeline_runs',
    'notification_preferences', 'notifications', 'crisis_briefs'
  )
order by relname;

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'users', 'monitored_entities', 'competitor_links', 'mentions',
    'sentiment_results', 'risk_scores', 'recommendations', 'pipeline_runs',
    'notification_preferences', 'notifications', 'crisis_briefs'
  )
order by tablename, policyname;

-- Must return zero rows. The service-role backend bypasses RLS; an anon-facing
-- INSERT policy with a literal true check would allow forged monitoring data.
select tablename, policyname, with_check
from pg_policies
where schemaname = 'public'
  and cmd = 'INSERT'
  and tablename in ('mentions', 'sentiment_results')
  and coalesce(with_check, '') in ('true', '(true)');

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'monitored_entities_user_idx', 'risk_scores_id_entity_unique_idx',
    'mentions_entity_created_idx',
    'mentions_entity_status_created_idx', 'sentiment_results_mention_idx',
    'recommendations_entity_created_idx', 'competitor_links_primary_idx',
    'mentions_entity_tavily_snapshot_unique',
    'crisis_briefs_entity_created_idx', 'crisis_briefs_event_key_idx',
    'crisis_briefs_status_idx', 'crisis_briefs_created_idx'
  )
order by indexname;

-- Must return zero rows. Any result means a tenant-owned child points to a
-- missing parent and should be repaired before deployment.
select 'mention_without_entity' as integrity_error, mention.id
from public.mentions mention
left join public.monitored_entities entity on entity.id = mention.entity_id
where entity.id is null
union all
select 'risk_without_entity', score.id
from public.risk_scores score
left join public.monitored_entities entity on entity.id = score.entity_id
where entity.id is null
union all
select 'recommendation_without_entity', recommendation.id
from public.recommendations recommendation
left join public.monitored_entities entity on entity.id = recommendation.entity_id
where entity.id is null
union all
select 'crisis_brief_without_entity', brief.id
from public.crisis_briefs brief
left join public.monitored_entities entity on entity.id = brief.entity_id
where entity.id is null
union all
select 'crisis_brief_without_risk_snapshot', brief.id
from public.crisis_briefs brief
left join public.risk_scores score on score.id = brief.risk_snapshot_id
where score.id is null
union all
select 'crisis_brief_risk_entity_mismatch', brief.id
from public.crisis_briefs brief
join public.risk_scores score on score.id = brief.risk_snapshot_id
where score.entity_id <> brief.entity_id;
