#!/bin/sh
set -eu

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"
export PGOPTIONS="-c statement_timeout=30s${PGOPTIONS:+ $PGOPTIONS}"

while true; do
  deleted=$(psql -XAt --no-password -v ON_ERROR_STOP=1 -c '
    SELECT iam_idp.purge_expired_audit_events()
         + iam_idp.purge_expired_sign_ins()
         + iam_idp.purge_expired_rate_limits()
         + iam_idp.purge_expired_app_grant_events()
         + iam_idp.purge_expired_membership_events()
         + iam_idp.purge_expired_oauth_client_events()
         + iam_idp.purge_expired_installation_role_events()
  ')
  if [ "$deleted" = 0 ]; then
    break
  fi
done

if [ -n "${IAM_SESSION_METADATA_RETENTION_HOURS:-}" ]; then
  while true; do
    cleared=$(psql -XAt --no-password -v ON_ERROR_STOP=1 -v hours="$IAM_SESSION_METADATA_RETENTION_HOURS" <<'SQL'
SELECT iam_idp.clear_expired_session_metadata(:'hours'::integer);
SQL
    )
    if [ "$cleared" = 0 ]; then
      break
    fi
  done
fi
