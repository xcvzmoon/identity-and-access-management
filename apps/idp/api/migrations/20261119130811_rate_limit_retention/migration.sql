SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_last_request_idx" ON "iam_idp"."rate_limits" ("last_request");
--> statement-breakpoint
CREATE FUNCTION iam_idp.purge_expired_rate_limits() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH expired AS (
    DELETE FROM iam_idp.rate_limits WHERE id IN (
      SELECT id FROM iam_idp.rate_limits
      WHERE last_request < floor(extract(epoch FROM statement_timestamp() - interval '720 hours') * 1000)::bigint
      ORDER BY last_request LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING 1
  )
  SELECT count(*) FROM expired;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.purge_expired_rate_limits() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.purge_expired_rate_limits() TO iam_audit_retention;
