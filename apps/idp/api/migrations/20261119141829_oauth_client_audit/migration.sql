SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_client_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"operation" text NOT NULL,
	"previous_disabled" boolean,
	"new_disabled" boolean,
	"credential_changed" boolean NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oauth_client_events_created_at_idx" ON "iam_idp"."oauth_client_events" ("created_at");
--> statement-breakpoint
REVOKE ALL ON iam_idp.oauth_client_events FROM PUBLIC, iam_idp_runtime;
--> statement-breakpoint
GRANT SELECT ON iam_idp.oauth_client_events TO iam_audit_reader;
--> statement-breakpoint
CREATE FUNCTION iam_idp.audit_oauth_client_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor uuid := nullif(current_setting('iam.management_actor_id', true), '')::uuid;
  client text;
  reference text;
  operation_name text;
  secret_changed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    client := OLD.client_id;
    reference := OLD.reference_id;
    operation_name := 'deleted';
  ELSE
    client := NEW.client_id;
    reference := NEW.reference_id;
    IF TG_OP = 'UPDATE' THEN
      secret_changed := OLD.client_secret IS DISTINCT FROM NEW.client_secret;
      IF NOT secret_changed AND OLD.disabled IS NOT DISTINCT FROM NEW.disabled THEN
        RETURN NULL;
      END IF;
      operation_name := 'updated';
    ELSE
      operation_name := 'created';
    END IF;
  END IF;

  INSERT INTO iam_idp.oauth_client_events
    (client_id, organization_id, actor_user_id, operation, previous_disabled, new_disabled, credential_changed)
  VALUES (client, CASE WHEN pg_input_is_valid(reference, 'uuid') THEN reference::uuid END,
          actor, operation_name, OLD.disabled, NEW.disabled, secret_changed);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.audit_oauth_client_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_oauth_client_change AFTER INSERT OR UPDATE OF disabled, client_secret OR DELETE ON iam_idp.oauth_clients
FOR EACH ROW EXECUTE FUNCTION iam_idp.audit_oauth_client_change();
--> statement-breakpoint
CREATE FUNCTION iam_idp.purge_expired_oauth_client_events() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH expired AS (
    DELETE FROM iam_idp.oauth_client_events WHERE id IN (
      SELECT id FROM iam_idp.oauth_client_events
      WHERE created_at < statement_timestamp() - interval '2160 hours'
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING 1
  )
  SELECT count(*) FROM expired;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.purge_expired_oauth_client_events() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.purge_expired_oauth_client_events() TO iam_audit_retention;
