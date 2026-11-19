#!/bin/sh
set -eu

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
    exit 0
  fi
done
