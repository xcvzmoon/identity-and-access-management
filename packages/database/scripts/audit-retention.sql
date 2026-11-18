\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply off
\endif

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';

SELECT set_config('iam.audit_retention_cutoff', :'cutoff', true) AS retention_cutoff
\gset

DO $$
DECLARE
  cutoff_text text := current_setting('iam.audit_retention_cutoff');
BEGIN
  IF cutoff_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
     OR cutoff_text::timestamptz >= statement_timestamp() THEN
    RAISE EXCEPTION 'Audit retention cutoff must be an absolute UTC timestamp in the past';
  END IF;
END
$$;

\if :apply
WITH expired AS (
  SELECT id
  FROM iam.app_access_events
  WHERE created_at < :'retention_cutoff'::timestamptz
  ORDER BY created_at, id
  LIMIT 1000
  FOR UPDATE
), removed AS (
  DELETE FROM iam.app_access_events AS event
  USING expired
  WHERE event.id = expired.id
  RETURNING 1
)
SELECT count(*) AS deleted_events FROM removed;
\else
SELECT count(*) AS eligible_events
FROM iam.app_access_events
WHERE created_at < :'retention_cutoff'::timestamptz;
\endif

COMMIT;
