\set ON_ERROR_STOP on

SELECT pg_catalog.pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS can_read_stats
\gset

\if :can_read_stats
WITH runtime_roles(role_name) AS (
  VALUES ('iam_idp_runtime'), ('iam_console_runtime')
)
SELECT
  statement_timestamp() AS sampled_at,
  runtime_roles.role_name,
  count(activity.pid) AS connected,
  count(*) FILTER (WHERE activity.state = 'active') AS active,
  count(*) FILTER (WHERE activity.state = 'idle') AS idle,
  count(*) FILTER (WHERE activity.state IN ('idle in transaction', 'idle in transaction (aborted)')) AS idle_in_transaction,
  count(*) FILTER (WHERE activity.wait_event_type = 'Lock') AS waiting_on_lock,
  count(*) FILTER (WHERE activity.state = 'disabled') AS activity_tracking_disabled
FROM runtime_roles
LEFT JOIN pg_catalog.pg_stat_activity AS activity
  ON activity.usename = runtime_roles.role_name
  AND activity.datname = current_database()
  AND activity.backend_type = 'client backend'
  AND activity.pid <> pg_backend_pid()
GROUP BY runtime_roles.role_name
ORDER BY runtime_roles.role_name;
\else
DO $$ BEGIN RAISE EXCEPTION 'Database session report requires pg_read_all_stats'; END $$;
\endif
