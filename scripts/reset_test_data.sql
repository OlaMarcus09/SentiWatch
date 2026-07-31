-- SentiWatch: reset test data ("Data + entities" scope)
-- Keeps: auth.users (login), users, profiles
-- Wipes: monitored_entities, competitor_links, mentions, sentiment_results,
--        risk_scores, recommendations, pipeline_runs
--
-- Run in Supabase Dashboard → SQL Editor. Review the BEFORE counts,
-- then let the transaction commit. If anything looks wrong, it rolls back.

BEGIN;

-- ── BEFORE: row counts so you can confirm what you're about to delete ──
SELECT 'monitored_entities' AS table, count(*) FROM monitored_entities
UNION ALL SELECT 'competitor_links',   count(*) FROM competitor_links
UNION ALL SELECT 'mentions',           count(*) FROM mentions
UNION ALL SELECT 'sentiment_results',  count(*) FROM sentiment_results
UNION ALL SELECT 'risk_scores',        count(*) FROM risk_scores
UNION ALL SELECT 'pipeline_runs',      count(*) FROM pipeline_runs
UNION ALL SELECT 'recommendations',    count(*) FROM recommendations;

-- ── DELETE in FK-safe order: children first, parents last ──
-- sentiment_results → mentions (mention_id)
DELETE FROM sentiment_results;
DELETE FROM pipeline_runs;

-- these all reference monitored_entities (entity_id)
DELETE FROM mentions;
DELETE FROM risk_scores;
DELETE FROM recommendations;
DELETE FROM competitor_links;

-- parent last
DELETE FROM monitored_entities;

-- ── AFTER: everything above should now read 0 ──
SELECT 'monitored_entities' AS table, count(*) FROM monitored_entities
UNION ALL SELECT 'competitor_links',   count(*) FROM competitor_links
UNION ALL SELECT 'mentions',           count(*) FROM mentions
UNION ALL SELECT 'sentiment_results',  count(*) FROM sentiment_results
UNION ALL SELECT 'risk_scores',        count(*) FROM risk_scores
UNION ALL SELECT 'pipeline_runs',      count(*) FROM pipeline_runs
UNION ALL SELECT 'recommendations',    count(*) FROM recommendations;

-- Confirm login/account data is untouched (should be > 0 if you have accounts)
SELECT 'users' AS table, count(*) FROM users;

COMMIT;
