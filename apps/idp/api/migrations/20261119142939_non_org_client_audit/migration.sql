CREATE OR REPLACE FUNCTION iam_idp.audit_oauth_client_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  org_id uuid;
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

  IF pg_input_is_valid(reference, 'uuid') THEN
    org_id := reference::uuid;
  END IF;
  INSERT INTO iam_idp.oauth_client_events
    (client_id, organization_id, actor_user_id, operation, previous_disabled, new_disabled, credential_changed)
  VALUES (client, org_id,
          actor, operation_name, OLD.disabled, NEW.disabled, secret_changed);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION iam_idp.audit_installation_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  org_id uuid;
  prior_catalog jsonb := OLD.metadata -> 'rolePermissions';
  next_catalog jsonb := NEW.metadata -> 'rolePermissions';
  reference text := coalesce(NEW.reference_id, OLD.reference_id);
BEGIN
  IF prior_catalog IS NOT DISTINCT FROM next_catalog THEN
    RETURN NULL;
  END IF;
  IF pg_input_is_valid(reference, 'uuid') THEN
    org_id := reference::uuid;
  END IF;
  INSERT INTO iam_idp.installation_role_events
    (client_id, organization_id, actor_user_id, role, previous_permissions, new_permissions)
  SELECT coalesce(NEW.client_id, OLD.client_id),
         org_id,
         nullif(current_setting('iam.management_actor_id', true), '')::uuid,
         role, prior.permissions, subsequent.permissions
  FROM iam_idp.installation_role_permissions(prior_catalog) AS prior
  FULL JOIN iam_idp.installation_role_permissions(next_catalog) AS subsequent USING (role)
  WHERE prior.permissions IS DISTINCT FROM subsequent.permissions;
  RETURN NULL;
END;
$$;
