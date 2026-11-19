#!/bin/sh
set -eu

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"

if ! state=$(psql -XqAt --no-password -v ON_ERROR_STOP=1 \
  -c "SET statement_timeout = '5s'" -c "
    SELECT CASE
      WHEN pg_is_in_recovery() THEN 'replica'
      WHEN count(*) FILTER (WHERE expires_at IS NULL AND activate_after IS NULL) <> 1 THEN 'active_count'
      WHEN bool_or(activate_after < statement_timestamp() - interval '2 minutes') THEN 'activation_overdue'
      WHEN bool_or(expires_at IS NULL AND activate_after IS NULL AND created_at < statement_timestamp() - interval '91 days') THEN 'signer_overdue'
      ELSE 'healthy'
    END
    FROM iam_idp.signing_keys
    WHERE alg = 'RS256'
  " 2>/dev/null); then
  echo 'UNKNOWN: unable to read signing-key state'
  exit 3
fi

case "$state" in
  healthy) echo 'OK: signing-key rotation is on schedule'; exit 0 ;;
  active_count) echo 'CRITICAL: expected exactly one active RS256 signer'; exit 2 ;;
  activation_overdue) echo 'CRITICAL: staged key activation is overdue'; exit 2 ;;
  signer_overdue) echo 'CRITICAL: active signing key is over 91 days old'; exit 2 ;;
  replica) echo 'UNKNOWN: configure the signing-key check against the primary'; exit 3 ;;
  *) echo 'UNKNOWN: unexpected signing-key check result'; exit 3 ;;
esac
