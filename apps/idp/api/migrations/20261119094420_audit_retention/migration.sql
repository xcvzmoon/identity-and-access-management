SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "iam_idp"."processed_owner_recovery_cases" (
	"digest" text PRIMARY KEY
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorization_events_created_at_idx" ON "iam_idp"."authorization_events" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owner_recovery_events_created_at_idx" ON "iam_idp"."owner_recovery_events" ("created_at");
--> statement-breakpoint
REVOKE ALL ON iam_idp.authorization_events, iam_idp.owner_recovery_events
  FROM PUBLIC, iam_idp_runtime;
--> statement-breakpoint
GRANT INSERT (client_id, organization_id, user_id, outcome, stage)
  ON iam_idp.authorization_events TO iam_idp_runtime;
--> statement-breakpoint
GRANT INSERT (organization_id, operator_id, case_reference, outcome)
  ON iam_idp.owner_recovery_events TO iam_idp_runtime;
--> statement-breakpoint
GRANT USAGE ON SCHEMA iam_idp TO iam_audit_reader, iam_audit_retention;
--> statement-breakpoint
GRANT SELECT ON iam_idp.authorization_events, iam_idp.owner_recovery_events TO iam_audit_reader;
--> statement-breakpoint
CREATE FUNCTION iam_idp.purge_expired_audit_events() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $purge$
  WITH expired_authorizations AS (
    DELETE FROM iam_idp.authorization_events
    WHERE id IN (
      SELECT id FROM iam_idp.authorization_events
      WHERE created_at < statement_timestamp() - interval '2160 hours'
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    RETURNING 1
  ), expired_recoveries AS (
    DELETE FROM iam_idp.owner_recovery_events
    WHERE id IN (
      SELECT id FROM iam_idp.owner_recovery_events
      WHERE created_at < statement_timestamp() - interval '2160 hours'
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM expired_authorizations) + (SELECT count(*) FROM expired_recoveries);
$purge$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.purge_expired_audit_events() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.purge_expired_audit_events() TO iam_audit_retention;
--> statement-breakpoint
REVOKE ALL ON iam_idp.processed_owner_recovery_cases FROM PUBLIC, iam_idp_runtime;
--> statement-breakpoint
CREATE FUNCTION iam_idp.reserve_owner_recovery_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $reserve$
BEGIN
  INSERT INTO iam_idp.processed_owner_recovery_cases (digest)
  VALUES (encode(sha256(convert_to(NEW.organization_id::text || NEW.case_reference, 'UTF8')), 'hex'))
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$reserve$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.reserve_owner_recovery_case() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER reserve_owner_recovery_case BEFORE INSERT ON iam_idp.owner_recovery_events
FOR EACH ROW EXECUTE FUNCTION iam_idp.reserve_owner_recovery_case();
--> statement-breakpoint
INSERT INTO iam_idp.processed_owner_recovery_cases (digest)
SELECT encode(sha256(convert_to(organization_id::text || case_reference, 'UTF8')), 'hex')
FROM iam_idp.owner_recovery_events;
