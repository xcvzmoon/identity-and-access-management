#!/bin/sh
set -eu

while true; do
  deleted=$(psql -XAt --no-password -v ON_ERROR_STOP=1 -c 'SELECT iam_idp.purge_expired_audit_events() + iam_idp.purge_expired_sign_ins() + iam_idp.purge_expired_rate_limits()')
  if [ "$deleted" = 0 ]; then
    exit 0
  fi
done
