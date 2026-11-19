SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_metadata_expiry_idx" ON "iam_idp"."sessions" ("expires_at") WHERE "ip_address" IS NOT NULL OR "user_agent" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION iam_idp.clear_expired_session_metadata(retain_hours integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  affected bigint;
BEGIN
  IF retain_hours IS NULL OR retain_hours < 0 THEN
    RAISE EXCEPTION 'Session metadata retention requires nonnegative hours';
  END IF;

  WITH expired AS (
    SELECT id FROM iam_idp.sessions
    WHERE expires_at <= statement_timestamp() - retain_hours * interval '1 hour'
      AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)
    ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
  )
  UPDATE iam_idp.sessions AS sessions SET ip_address = NULL, user_agent = NULL
  FROM expired WHERE sessions.id = expired.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.clear_expired_session_metadata(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.clear_expired_session_metadata(integer) TO iam_audit_retention;
