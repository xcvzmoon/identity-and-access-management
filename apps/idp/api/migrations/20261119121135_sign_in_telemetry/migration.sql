CREATE TABLE "iam_idp"."sign_in_counts" (
	"day" date,
	"entry" text,
	"outcome" text,
	"total" bigint NOT NULL,
	CONSTRAINT "sign_in_counts_pkey" PRIMARY KEY("day","entry","outcome"),
	CONSTRAINT "sign_in_counts_entry" CHECK ("entry" in ('web_form', 'api')),
	CONSTRAINT "sign_in_counts_outcome" CHECK ("outcome" in ('issued', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."sign_in_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"entry" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_in_events_entry" CHECK ("entry" in ('web_form', 'api'))
);
--> statement-breakpoint
CREATE INDEX "sign_in_events_account_idx" ON "iam_idp"."sign_in_events" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_events_expiry_idx" ON "iam_idp"."sign_in_events" ("created_at");
--> statement-breakpoint
REVOKE ALL ON iam_idp.sign_in_counts, iam_idp.sign_in_events FROM PUBLIC, iam_idp_runtime;
--> statement-breakpoint
GRANT SELECT ON iam_idp.sign_in_counts, iam_idp.sign_in_events TO iam_audit_reader;
--> statement-breakpoint
CREATE FUNCTION iam_idp.increment_sign_in(entry_point text, result text) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO iam_idp.sign_in_counts (day, entry, outcome, total)
  VALUES ((statement_timestamp() AT TIME ZONE 'UTC')::date, entry_point, result, 1)
  ON CONFLICT (day, entry, outcome) DO UPDATE SET total = iam_idp.sign_in_counts.total + 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.increment_sign_in(text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION iam_idp.record_password_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  entry_point text := current_setting('iam.sign_in_entry', true);
BEGIN
  INSERT INTO iam_idp.sign_in_events (user_id, entry, created_at)
    VALUES (NEW.user_id, entry_point, statement_timestamp());
  PERFORM iam_idp.increment_sign_in(entry_point, 'issued');
  PERFORM set_config('iam.sign_in_issued', 'yes', true);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.record_password_session() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_password_session AFTER INSERT ON iam_idp.sessions
FOR EACH ROW WHEN (current_setting('iam.sign_in_entry', true) IN ('web_form', 'api'))
EXECUTE FUNCTION iam_idp.record_password_session();
--> statement-breakpoint
CREATE FUNCTION iam_idp.record_rejected_sign_in() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT iam_idp.increment_sign_in(current_setting('iam.sign_in_entry'), 'rejected')
  WHERE current_setting('iam.sign_in_issued', true) IS DISTINCT FROM 'yes';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.record_rejected_sign_in() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.record_rejected_sign_in() TO iam_idp_runtime;
--> statement-breakpoint
CREATE FUNCTION iam_idp.purge_expired_sign_ins() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH expired AS (
    DELETE FROM iam_idp.sign_in_events WHERE id IN (
      SELECT id FROM iam_idp.sign_in_events WHERE created_at < statement_timestamp() - interval '720 hours'
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING 1
  ), old_counts AS (
    DELETE FROM iam_idp.sign_in_counts
    WHERE day < (statement_timestamp() AT TIME ZONE 'UTC')::date - 89 RETURNING 1
  )
  SELECT (SELECT count(*) FROM expired) + (SELECT count(*) FROM old_counts);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.purge_expired_sign_ins() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.purge_expired_sign_ins() TO iam_audit_retention;
