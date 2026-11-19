SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "iam_idp"."membership_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"previous_role" text,
	"new_role" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "membership_events_created_at_idx" ON "iam_idp"."membership_events" ("created_at");
--> statement-breakpoint
REVOKE ALL ON iam_idp.membership_events FROM PUBLIC, iam_idp_runtime;
--> statement-breakpoint
GRANT SELECT ON iam_idp.membership_events TO iam_audit_reader;
--> statement-breakpoint
CREATE FUNCTION iam_idp.audit_membership_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor uuid := nullif(current_setting('iam.management_actor_id', true), '')::uuid;
  prior_role text;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.organization_id, OLD.user_id) =
                          (NEW.organization_id, NEW.user_id) THEN
    IF OLD.role = NEW.role THEN
      RETURN NULL;
    END IF;
    prior_role := OLD.role;
  ELSIF TG_OP <> 'INSERT' THEN
    INSERT INTO iam_idp.membership_events (organization_id, user_id, actor_user_id, previous_role)
    VALUES (OLD.organization_id, OLD.user_id, actor, OLD.role);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    INSERT INTO iam_idp.membership_events (organization_id, user_id, actor_user_id, previous_role, new_role)
    VALUES (NEW.organization_id, NEW.user_id, actor, prior_role, NEW.role);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.audit_membership_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_membership_change AFTER INSERT OR UPDATE OR DELETE ON iam_idp.memberships
FOR EACH ROW EXECUTE FUNCTION iam_idp.audit_membership_change();
--> statement-breakpoint
CREATE FUNCTION iam_idp.purge_expired_membership_events() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH expired AS (
    DELETE FROM iam_idp.membership_events WHERE id IN (
      SELECT id FROM iam_idp.membership_events
      WHERE created_at < statement_timestamp() - interval '2160 hours'
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING 1
  )
  SELECT count(*) FROM expired;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.purge_expired_membership_events() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.purge_expired_membership_events() TO iam_audit_retention;
