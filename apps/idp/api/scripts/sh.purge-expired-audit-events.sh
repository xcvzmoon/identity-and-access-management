#!/bin/sh
set -eu

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"
export PGOPTIONS="-c statement_timeout=30s${PGOPTIONS:+ $PGOPTIONS}"

deleted_total=0
cleared_total=null

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
  case "$deleted" in
    0) break ;;
    ''|0*|*[!0-9]*) echo 'Unexpected purge row count' >&2; exit 1 ;;
    *) deleted_total=$((deleted_total + deleted)) ;;
  esac
done

if [ -n "${IAM_SESSION_METADATA_RETENTION_HOURS:-}" ]; then
  cleared_total=0
  while true; do
    cleared=$(psql -XAt --no-password -v ON_ERROR_STOP=1 -v hours="$IAM_SESSION_METADATA_RETENTION_HOURS" <<'SQL'
SELECT iam_idp.clear_expired_session_metadata(:'hours'::integer);
SQL
    )
    case "$cleared" in
      0) break ;;
      ''|0*|*[!0-9]*) echo 'Unexpected session cleanup row count' >&2; exit 1 ;;
      *) cleared_total=$((cleared_total + cleared)) ;;
    esac
  done
fi

printf '{"event":"retention-completed","deletedRows":%s,"sessionsCleared":%s}\n' "$deleted_total" "$cleared_total"
