\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply off
\endif

\if :apply
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

SELECT set_config('iam.deletion_user_id', :'user_id', true) AS deletion_user_id
\gset

DO $$
DECLARE
  account_id uuid := current_setting('iam.deletion_user_id');
  account_email text;
BEGIN
  SELECT lower(email) INTO account_email
  FROM iam.users
  WHERE id = account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'IAM account was not found';
  END IF;

  PERFORM id
  FROM iam.members
  WHERE user_id = account_id
  ORDER BY id
  FOR UPDATE;

  IF EXISTS (
    SELECT FROM iam.members
    WHERE user_id = account_id AND 'owner' = ANY (string_to_array(role, ','))
  ) THEN
    RAISE EXCEPTION 'Transfer organization ownership before deleting this account';
  END IF;

  IF EXISTS (SELECT FROM iam.oauth_clients WHERE user_id = account_id) THEN
    RAISE EXCEPTION 'Resolve user-owned OAuth clients before deleting this account';
  END IF;

  IF EXISTS (SELECT FROM iam.users WHERE id <> account_id AND lower(email) = account_email) THEN
    RAISE EXCEPTION 'Resolve accounts with the same normalized email before deletion';
  END IF;

  DELETE FROM iam.invitations WHERE email = account_email;
  DELETE FROM iam.rate_limits
  WHERE key IN ('iam:email-verification:' || account_id::text,
                'iam:password-recovery:' || account_id::text,
                'iam:admin-password-check:' || account_id::text);
  DELETE FROM iam.verifications
  WHERE identifier IN ('email-verification-otp-' || account_email,
                       'forget-password-otp-' || account_email)
     OR CASE WHEN value IS JSON OBJECT THEN
       value::json->>'type' = 'authorization_code'
       AND value::json->>'userId' = account_id::text
     ELSE false END;

  DELETE FROM iam.users WHERE id = account_id;
END
$$;

COMMIT;
\echo IAM account deletion committed.
\else
\echo Run account-deletion-preflight.sql to preview, then pass apply=on to delete the approved account.
\endif
