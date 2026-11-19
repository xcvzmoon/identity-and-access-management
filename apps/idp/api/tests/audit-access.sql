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

ROLLBACK;
