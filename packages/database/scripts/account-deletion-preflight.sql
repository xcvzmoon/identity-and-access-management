\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

WITH target AS (
  SELECT id, email FROM iam.users WHERE id = :'user_id'::uuid
), memberships AS (
  SELECT members.id, members.role
  FROM iam.members
  JOIN target ON target.id = members.user_id
), audit_counts AS (
  SELECT
    count(*) FILTER (WHERE event.actor_id = target.id) AS actor_events,
    count(*) FILTER (WHERE event.action IN ('assignment.granted', 'assignment.revoked')
      AND event.details->>'memberId' IN (SELECT id::text FROM memberships)) AS assignment_events
  FROM iam.app_access_events AS event
  CROSS JOIN target
), authorization_codes AS (
  SELECT CASE WHEN value IS JSON OBJECT THEN value::json END AS payload
  FROM iam.verifications
)
SELECT
  (SELECT count(*) FROM iam.accounts WHERE user_id = target.id) AS credential_accounts,
  (SELECT count(*) FROM iam.sessions WHERE user_id = target.id) AS sessions,
  (SELECT count(*) FROM iam.passkeys WHERE user_id = target.id) AS passkeys,
  (SELECT count(*) FROM memberships) AS memberships,
  (SELECT count(*) FROM memberships WHERE 'owner' = ANY (string_to_array(role, ','))) AS owner_memberships,
  (SELECT count(*) FROM iam.app_assignments WHERE member_id IN (SELECT id FROM memberships)) AS assignments,
  (SELECT count(*) FROM iam.oauth_clients WHERE user_id = target.id) AS user_owned_clients,
  (SELECT count(*) FROM iam.oauth_access_tokens WHERE user_id = target.id) AS access_tokens,
  (SELECT count(*) FROM iam.oauth_refresh_tokens WHERE user_id = target.id) AS refresh_tokens,
  (SELECT count(*) FROM iam.oauth_consents WHERE user_id = target.id) AS consents,
  (SELECT count(*) FROM iam.invitations WHERE inviter_id = target.id) AS sent_invitations,
  (SELECT count(*) FROM iam.invitations WHERE email = lower(target.email)) AS received_invitations,
  (SELECT count(*) FROM iam.verifications
    WHERE identifier IN ('email-verification-otp-' || lower(target.email),
                         'forget-password-otp-' || lower(target.email))) AS email_verifications,
  (SELECT count(*) FROM authorization_codes
    WHERE payload->>'type' = 'authorization_code' AND payload->>'userId' = target.id::text) AS authorization_codes,
  (SELECT count(*) FROM iam.rate_limits
    WHERE key IN ('iam:email-verification:' || target.id::text,
                  'iam:password-recovery:' || target.id::text)) AS email_rate_limits,
  (SELECT count(*) FROM iam.rate_limits
    WHERE key = 'iam:admin-password-check:' || target.id::text) AS admin_password_rate_limits,
  audit_counts.actor_events AS audit_actor_events,
  audit_counts.assignment_events AS audit_assignment_events
FROM target
CROSS JOIN audit_counts;

COMMIT;
