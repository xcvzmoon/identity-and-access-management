SELECT
  :'installation_id'::uuid AS installation_id,
  count(*) FILTER (WHERE action = 'client.callback_replaced') AS callback_changes,
  count(*) FILTER (WHERE action = 'assignment.granted') AS grant_operations
FROM iam.app_access_events
WHERE installation_id = :'installation_id'::uuid
  AND created_at >= statement_timestamp() - interval '5 minutes'
  AND created_at <= statement_timestamp()
  AND action IN ('client.callback_replaced', 'assignment.granted');
