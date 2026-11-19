\set ON_ERROR_STOP on
BEGIN;

DO $verify$
BEGIN
  IF current_database() <> 'iam_phase8_test' THEN
    RAISE EXCEPTION 'Run against the disposable iam_phase8_test database';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_idp_runtime;

INSERT INTO iam_idp.authorization_events (client_id, outcome, stage)
VALUES ('audit-access-fixture', 'approved', 'authorization');

INSERT INTO iam_idp.owner_recovery_events (organization_id, operator_id, case_reference, outcome)
VALUES (uuidv7(), uuidv7(), 'audit-access-fixture', 'invited');

DO $verify$
DECLARE
  audit_table regclass;
  role_name name;
BEGIN
  BEGIN
    PERFORM 1 FROM iam_idp.authorization_events;
    RAISE EXCEPTION 'Runtime could read authorization events';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM iam_idp.owner_recovery_events;
    RAISE EXCEPTION 'Runtime could delete recovery events';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  FOREACH audit_table IN ARRAY ARRAY[
    'iam_idp.authorization_events'::regclass,
    'iam_idp.owner_recovery_events'::regclass
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['iam_idp_runtime', 'iam_audit_reader', 'iam_audit_retention', 'iam_console_runtime'] LOOP
      IF has_any_column_privilege(role_name, audit_table, 'SELECT') <> (role_name = 'iam_audit_reader')
        OR has_any_column_privilege(role_name, audit_table, 'INSERT') <> (role_name = 'iam_idp_runtime')
        OR has_any_column_privilege(role_name, audit_table, 'UPDATE')
        OR has_table_privilege(role_name, audit_table, 'DELETE, TRUNCATE, TRIGGER')
        OR has_column_privilege(role_name, audit_table, 'created_at', 'INSERT')
        OR has_any_column_privilege(role_name, 'iam_idp.processed_owner_recovery_cases', 'INSERT, SELECT, UPDATE')
        OR has_table_privilege(role_name, 'iam_idp.processed_owner_recovery_cases', 'DELETE, TRUNCATE, TRIGGER')
        OR has_function_privilege(role_name, 'iam_idp.purge_expired_audit_events()', 'EXECUTE')
          <> (role_name = 'iam_audit_retention') THEN
        RAISE EXCEPTION 'Unexpected privileges for % on %', role_name, audit_table;
      END IF;
    END LOOP;
  END LOOP;
END
$verify$;

RESET ROLE;

INSERT INTO iam_idp.authorization_events (client_id, outcome, stage, created_at)
VALUES ('expired-audit-fixture', 'denied', 'authorization', now() - interval '91 days');

INSERT INTO iam_idp.owner_recovery_events (organization_id, operator_id, case_reference, outcome, created_at)
VALUES ('eb2f17ba-0dd3-493f-80ad-99e6b6f96bf1', uuidv7(), 'expired-audit-fixture', 'invited', now() - interval '91 days');

SET LOCAL ROLE iam_audit_retention;

SELECT iam_idp.purge_expired_audit_events();

SET LOCAL ROLE iam_idp_runtime;

DO $verify$
BEGIN
  INSERT INTO iam_idp.owner_recovery_events (organization_id, operator_id, case_reference, outcome)
  VALUES ('eb2f17ba-0dd3-493f-80ad-99e6b6f96bf1', uuidv7(), 'expired-audit-fixture', 'invited');

  IF FOUND THEN
    RAISE EXCEPTION 'An expired recovery case was processed twice';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_audit_reader;

DO $verify$
BEGIN
  IF EXISTS (SELECT FROM iam_idp.authorization_events WHERE client_id = 'expired-audit-fixture')
    OR EXISTS (SELECT FROM iam_idp.owner_recovery_events WHERE case_reference = 'expired-audit-fixture')
    OR NOT EXISTS (SELECT FROM iam_idp.authorization_events WHERE client_id = 'audit-access-fixture')
    OR NOT EXISTS (SELECT FROM iam_idp.owner_recovery_events WHERE case_reference = 'audit-access-fixture') THEN
    RAISE EXCEPTION 'Retention did not preserve exactly the unexpired fixture rows';
  END IF;
END
$verify$;

RESET ROLE;

INSERT INTO iam_idp.sign_in_events (user_id, entry, created_at)
VALUES (uuidv7(), 'api', now() - interval '31 days'), (uuidv7(), 'web_form', now());

INSERT INTO iam_idp.sign_in_counts (day, entry, outcome, total)
VALUES ((now() AT TIME ZONE 'UTC')::date - 90, 'api', 'issued', 1);

SET LOCAL ROLE iam_idp_runtime;
SELECT set_config('iam.sign_in_entry', 'api', true);
SELECT iam_idp.record_rejected_sign_in();
SELECT iam_idp.record_rejected_sign_in();

DO $verify$
BEGIN
  IF has_table_privilege(current_user, 'iam_idp.sign_in_counts', 'SELECT, INSERT, UPDATE, DELETE')
    OR has_table_privilege(current_user, 'iam_idp.sign_in_events', 'SELECT, INSERT, UPDATE, DELETE')
    OR has_function_privilege(current_user, 'iam_idp.purge_expired_sign_ins()', 'EXECUTE')
    OR has_function_privilege('iam_audit_reader', 'iam_idp.record_rejected_sign_in()', 'EXECUTE')
    OR has_table_privilege('iam_audit_retention', 'iam_idp.sign_in_events', 'SELECT') THEN
    RAISE EXCEPTION 'Unexpected sign-in telemetry privileges';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_audit_retention;
SELECT iam_idp.purge_expired_sign_ins();

SET LOCAL ROLE iam_audit_reader;
DO $verify$
BEGIN
  IF EXISTS (SELECT FROM iam_idp.sign_in_events WHERE created_at < now() - interval '30 days')
    OR NOT EXISTS (SELECT FROM iam_idp.sign_in_events WHERE entry = 'web_form' AND created_at = now()::timestamptz(3))
    OR EXISTS (SELECT FROM iam_idp.sign_in_counts WHERE day <= (now() AT TIME ZONE 'UTC')::date - 90)
    OR NOT EXISTS (SELECT FROM iam_idp.sign_in_counts WHERE entry = 'api' AND outcome = 'rejected' AND total >= 2) THEN
    RAISE EXCEPTION 'Incorrect sign-in telemetry retention or counter';
  END IF;
END
$verify$;

RESET ROLE;

INSERT INTO iam_idp.rate_limits (key, count, last_request)
SELECT 'retention-fixture-' || value, 1, 0 FROM generate_series(1, 1001) AS value;

INSERT INTO iam_idp.rate_limits (key, count, last_request)
VALUES ('recent-retention-fixture', 1, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint);

SET LOCAL ROLE iam_audit_retention;

DO $verify$
BEGIN
  IF has_table_privilege(current_user, 'iam_idp.rate_limits', 'SELECT, UPDATE, DELETE')
    OR has_function_privilege('iam_idp_runtime', 'iam_idp.purge_expired_rate_limits()', 'EXECUTE')
    OR has_function_privilege('iam_audit_reader', 'iam_idp.purge_expired_rate_limits()', 'EXECUTE')
    OR has_function_privilege('iam_console_runtime', 'iam_idp.purge_expired_rate_limits()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected rate-limit retention privileges';
  END IF;

  IF iam_idp.purge_expired_rate_limits() <> 1000 THEN
    RAISE EXCEPTION 'Expected a bounded first batch of expired rate limits';
  END IF;

  WHILE iam_idp.purge_expired_rate_limits() > 0 LOOP
    NULL;
  END LOOP;
END
$verify$;

RESET ROLE;

DO $verify$
BEGIN
  IF EXISTS (SELECT FROM iam_idp.rate_limits WHERE key LIKE 'retention-fixture-%')
    OR NOT EXISTS (SELECT FROM iam_idp.rate_limits WHERE key = 'recent-retention-fixture') THEN
    RAISE EXCEPTION 'Rate-limit retention failed to distinguish stale and active buckets';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_idp_runtime;
INSERT INTO iam_idp.users (name,email) VALUES ('Grant fixture','grant-audit@example.invalid');
INSERT INTO iam_idp.organizations (name,slug,created_at) VALUES ('Grant fixture','grant-audit',now());
INSERT INTO iam_idp.memberships (user_id,organization_id,role,created_at)
SELECT u.id,o.id,'member',now() FROM iam_idp.users u CROSS JOIN iam_idp.organizations o
WHERE u.email='grant-audit@example.invalid' AND o.slug='grant-audit';
INSERT INTO iam_idp.oauth_clients (client_id,redirect_uris) VALUES ('grant-audit',ARRAY['https://audit.invalid/callback']);
INSERT INTO iam_idp.app_installations (client_id,organization_id)
SELECT 'grant-audit',id FROM iam_idp.organizations WHERE slug='grant-audit';
INSERT INTO iam_idp.app_grants (client_id,user_id,organization_id,role)
SELECT 'grant-audit',m.user_id,m.organization_id,'reader' FROM iam_idp.memberships m
JOIN iam_idp.organizations o ON o.id=m.organization_id WHERE o.slug='grant-audit';

SET LOCAL iam.management_actor_id = '00000000-0000-4000-8000-000000000123';
UPDATE iam_idp.app_grants SET role='editor' WHERE client_id='grant-audit';
UPDATE iam_idp.app_grants SET role='editor' WHERE client_id='grant-audit';
SAVEPOINT before_reversal;
UPDATE iam_idp.app_grants SET role='reader' WHERE client_id='grant-audit';
ROLLBACK TO before_reversal;
DELETE FROM iam_idp.app_installations WHERE client_id='grant-audit';

SET LOCAL ROLE iam_audit_reader;
DO $verify$
BEGIN
  IF (SELECT count(*) FROM iam_idp.app_grant_events WHERE client_id='grant-audit') <> 3 OR
     NOT EXISTS (SELECT FROM iam_idp.app_grant_events WHERE client_id='grant-audit' AND actor_user_id IS NULL AND previous_role IS NULL AND new_role='reader') OR
     NOT EXISTS (SELECT FROM iam_idp.app_grant_events WHERE client_id='grant-audit' AND actor_user_id='00000000-0000-4000-8000-000000000123' AND previous_role='reader' AND new_role='editor') OR
     NOT EXISTS (SELECT FROM iam_idp.app_grant_events WHERE client_id='grant-audit' AND actor_user_id='00000000-0000-4000-8000-000000000123' AND previous_role='editor' AND new_role IS NULL) OR
     has_table_privilege('iam_idp_runtime','iam_idp.app_grant_events','SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'Grant history or access restrictions mismatch';
  END IF;
END
$verify$;
RESET ROLE;
UPDATE iam_idp.app_grant_events SET created_at=now()-interval '91 days' WHERE client_id='grant-audit' AND previous_role IS NULL;
SET LOCAL ROLE iam_audit_retention;
DO $verify$
BEGIN
  IF iam_idp.purge_expired_app_grant_events() <> 1 THEN
    RAISE EXCEPTION 'Grant audit retention mismatch';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_idp_runtime;
UPDATE iam_idp.memberships SET role='admin'
WHERE organization_id=(SELECT id FROM iam_idp.organizations WHERE slug='grant-audit');
UPDATE iam_idp.memberships SET role='admin'
WHERE organization_id=(SELECT id FROM iam_idp.organizations WHERE slug='grant-audit');
SAVEPOINT before_membership_reversal;
UPDATE iam_idp.memberships SET role='member'
WHERE organization_id=(SELECT id FROM iam_idp.organizations WHERE slug='grant-audit');
ROLLBACK TO before_membership_reversal;
DELETE FROM iam_idp.users WHERE email='grant-audit@example.invalid';

RESET ROLE;
SELECT set_config('iam.fixture_org', id::text, true) FROM iam_idp.organizations WHERE slug='grant-audit';
SET LOCAL ROLE iam_audit_reader;
DO $verify$
DECLARE
  org uuid := current_setting('iam.fixture_org')::uuid;
  actor uuid := '00000000-0000-4000-8000-000000000123';
BEGIN
  IF (SELECT count(*) FROM iam_idp.membership_events WHERE organization_id=org) <> 3 OR
     NOT EXISTS (SELECT FROM iam_idp.membership_events WHERE organization_id=org AND actor_user_id IS NULL AND previous_role IS NULL AND new_role='member') OR
     NOT EXISTS (SELECT FROM iam_idp.membership_events WHERE organization_id=org AND actor_user_id=actor AND previous_role='member' AND new_role='admin') OR
     NOT EXISTS (SELECT FROM iam_idp.membership_events WHERE organization_id=org AND actor_user_id=actor AND previous_role='admin' AND new_role IS NULL) OR
     has_table_privilege('iam_idp_runtime','iam_idp.membership_events','SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'Membership history or privileges mismatch';
  END IF;
END
$verify$;

RESET ROLE;
UPDATE iam_idp.membership_events SET created_at=now()-interval '91 days'
WHERE organization_id=current_setting('iam.fixture_org')::uuid AND previous_role IS NULL;
SET LOCAL ROLE iam_audit_retention;
DO $verify$
BEGIN
  IF iam_idp.purge_expired_membership_events() <> 1 THEN
    RAISE EXCEPTION 'Membership audit retention mismatch';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_idp_runtime;
INSERT INTO iam_idp.oauth_clients (client_id, reference_id, client_secret, redirect_uris)
VALUES ('client-audit', current_setting('iam.fixture_org'), 'fixture-before', ARRAY['https://audit.invalid/callback']);
UPDATE iam_idp.oauth_clients SET disabled=false WHERE client_id='client-audit';
UPDATE iam_idp.oauth_clients SET client_secret='fixture-after' WHERE client_id='client-audit';
SAVEPOINT before_client_disable;
UPDATE iam_idp.oauth_clients SET disabled=true WHERE client_id='client-audit';
ROLLBACK TO before_client_disable;
UPDATE iam_idp.oauth_clients SET disabled=true WHERE client_id='client-audit';
DELETE FROM iam_idp.oauth_clients WHERE client_id='client-audit';

SET LOCAL ROLE iam_audit_reader;
DO $verify$
DECLARE
  org uuid := current_setting('iam.fixture_org')::uuid;
  actor uuid := '00000000-0000-4000-8000-000000000123';
BEGIN
  IF (SELECT count(*) FROM iam_idp.oauth_client_events WHERE client_id='client-audit') <> 4 OR
     EXISTS (SELECT FROM iam_idp.oauth_client_events WHERE client_id='client-audit'
             AND (actor_user_id IS DISTINCT FROM actor OR organization_id IS DISTINCT FROM org)) OR
     NOT EXISTS (SELECT FROM iam_idp.oauth_client_events WHERE client_id='client-audit' AND operation='created' AND previous_disabled IS NULL AND new_disabled=false) OR
     NOT EXISTS (SELECT FROM iam_idp.oauth_client_events WHERE client_id='client-audit' AND operation='updated' AND credential_changed AND previous_disabled=false AND new_disabled=false) OR
     NOT EXISTS (SELECT FROM iam_idp.oauth_client_events WHERE client_id='client-audit' AND operation='updated' AND NOT credential_changed AND previous_disabled=false AND new_disabled=true) OR
     NOT EXISTS (SELECT FROM iam_idp.oauth_client_events WHERE client_id='client-audit' AND operation='deleted' AND previous_disabled=true AND new_disabled IS NULL) OR
     EXISTS (SELECT FROM iam_idp.oauth_client_events e WHERE to_jsonb(e)::text LIKE '%fixture-before%' OR to_jsonb(e)::text LIKE '%fixture-after%') OR
     has_table_privilege('iam_idp_runtime','iam_idp.oauth_client_events','SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'OAuth client history or access restrictions mismatch';
  END IF;
END
$verify$;
RESET ROLE;
UPDATE iam_idp.oauth_client_events SET created_at=now()-interval '91 days' WHERE client_id='client-audit' AND operation='deleted';
SET LOCAL ROLE iam_audit_retention;
DO $verify$
BEGIN
  IF iam_idp.purge_expired_oauth_client_events() <> 1 THEN
    RAISE EXCEPTION 'OAuth client audit retention mismatch';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_idp_runtime;
INSERT INTO iam_idp.oauth_clients (client_id, reference_id, redirect_uris, metadata)
VALUES ('role-audit', current_setting('iam.fixture_org'), ARRAY['https://audit.invalid/callback'],
        '{"rolePermissions":{"editor":["write","read"],"guest":[]},"private":"fixture-unrelated"}');
UPDATE iam_idp.oauth_clients SET metadata='{"rolePermissions":{"editor":["read","write","read"],"guest":[]}}'
WHERE client_id='role-audit';
SAVEPOINT before_role_edit;
UPDATE iam_idp.oauth_clients SET metadata='{"rolePermissions":{"invalid":[false]}}' WHERE client_id='role-audit';
ROLLBACK TO before_role_edit;
UPDATE iam_idp.oauth_clients SET metadata='{"rolePermissions":{"editor":["read"]}}' WHERE client_id='role-audit';
DELETE FROM iam_idp.oauth_clients WHERE client_id='role-audit';

SET LOCAL ROLE iam_audit_reader;
DO $verify$
BEGIN
  IF (SELECT count(*) FROM iam_idp.installation_role_events WHERE client_id='role-audit') <> 5 OR
     NOT EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='role-audit' AND role='editor'
                 AND previous_permissions IS NULL AND new_permissions=ARRAY['read','write']) OR
     NOT EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='role-audit' AND role='editor'
                 AND previous_permissions=ARRAY['read','write'] AND new_permissions=ARRAY['read']) OR
     NOT EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='role-audit' AND role='editor'
                 AND previous_permissions=ARRAY['read'] AND new_permissions IS NULL) OR
     NOT EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='role-audit' AND role='guest'
                 AND previous_permissions IS NULL AND new_permissions=ARRAY[]::text[]) OR
     NOT EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='role-audit' AND role='guest'
                 AND previous_permissions=ARRAY[]::text[] AND new_permissions IS NULL) OR
     EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='role-audit'
             AND (actor_user_id IS DISTINCT FROM current_setting('iam.management_actor_id')::uuid
             OR organization_id IS DISTINCT FROM current_setting('iam.fixture_org')::uuid)) OR
     has_table_privilege('iam_idp_runtime','iam_idp.installation_role_events','SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'Installation role history or privileges mismatch';
  END IF;
END
$verify$;
RESET ROLE;
UPDATE iam_idp.installation_role_events SET created_at=now()-interval '91 days'
WHERE client_id='role-audit' AND role='guest' AND new_permissions IS NULL;
SET LOCAL ROLE iam_audit_retention;
DO $verify$
BEGIN
  IF iam_idp.purge_expired_installation_role_events() <> 1 THEN
    RAISE EXCEPTION 'Installation role retention mismatch';
  END IF;
END
$verify$;

SET LOCAL ROLE iam_idp_runtime;
INSERT INTO iam_idp.oauth_clients (client_id, reference_id, redirect_uris, metadata)
VALUES ('reserved-reference-fixture', 'iam-console', ARRAY['https://console.invalid/callback'],
        '{"rolePermissions":{"reader":["read"]}}');
SET LOCAL ROLE iam_audit_reader;
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM iam_idp.oauth_client_events WHERE client_id='reserved-reference-fixture'
                 AND operation='created' AND organization_id IS NULL) OR
     NOT EXISTS (SELECT FROM iam_idp.installation_role_events WHERE client_id='reserved-reference-fixture'
                 AND role='reader' AND organization_id IS NULL) THEN
    RAISE EXCEPTION 'Expected client and role audit events without organization attribution';
  END IF;
END
$verify$;

ROLLBACK;
