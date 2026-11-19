SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "iam_idp"."installation_role_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"role" text NOT NULL,
	"previous_permissions" text[],
	"new_permissions" text[],
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "installation_role_events_created_at_idx" ON "iam_idp"."installation_role_events" ("created_at");
--> statement-breakpoint
REVOKE ALL ON iam_idp.installation_role_events FROM PUBLIC, iam_idp_runtime;
--> statement-breakpoint
GRANT SELECT ON iam_idp.installation_role_events TO iam_audit_reader;
--> statement-breakpoint
CREATE FUNCTION iam_idp.installation_role_permissions(catalog jsonb)
RETURNS TABLE(role text, permissions text[])
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF jsonb_typeof(catalog) <> 'object' THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT FROM jsonb_each(catalog) AS entry
    WHERE CASE WHEN jsonb_typeof(entry.value) = 'array' THEN
      EXISTS (SELECT FROM jsonb_array_elements(entry.value) AS item WHERE jsonb_typeof(item) <> 'string')
    ELSE true END
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT entry.key, ARRAY(
    SELECT DISTINCT permission COLLATE "C" FROM jsonb_array_elements_text(entry.value) AS permission ORDER BY 1
  ) FROM jsonb_each(catalog) AS entry;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.installation_role_permissions(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION iam_idp.audit_installation_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  prior_catalog jsonb := OLD.metadata -> 'rolePermissions';
  next_catalog jsonb := NEW.metadata -> 'rolePermissions';
  reference text := coalesce(NEW.reference_id, OLD.reference_id);
BEGIN
  IF prior_catalog IS NOT DISTINCT FROM next_catalog THEN
    RETURN NULL;
  END IF;
  INSERT INTO iam_idp.installation_role_events
    (client_id, organization_id, actor_user_id, role, previous_permissions, new_permissions)
  SELECT coalesce(NEW.client_id, OLD.client_id),
         CASE WHEN pg_input_is_valid(reference, 'uuid') THEN reference::uuid END,
         nullif(current_setting('iam.management_actor_id', true), '')::uuid,
         role, prior.permissions, subsequent.permissions
  FROM iam_idp.installation_role_permissions(prior_catalog) AS prior
  FULL JOIN iam_idp.installation_role_permissions(next_catalog) AS subsequent USING (role)
  WHERE prior.permissions IS DISTINCT FROM subsequent.permissions;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.audit_installation_roles() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_installation_roles AFTER INSERT OR UPDATE OF metadata OR DELETE ON iam_idp.oauth_clients
FOR EACH ROW EXECUTE FUNCTION iam_idp.audit_installation_roles();
--> statement-breakpoint
CREATE FUNCTION iam_idp.purge_expired_installation_role_events() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH expired AS (
    DELETE FROM iam_idp.installation_role_events WHERE id IN (
      SELECT id FROM iam_idp.installation_role_events
      WHERE created_at < statement_timestamp() - interval '2160 hours'
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) RETURNING 1
  )
  SELECT count(*) FROM expired;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.purge_expired_installation_role_events() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION iam_idp.purge_expired_installation_role_events() TO iam_audit_retention;
