#!/bin/sh
set -eu

while true; do
  deleted=$(psql -XAt --no-password -v ON_ERROR_STOP=1 -c 'SELECT iam_idp.purge_expired_audit_events()')
  if [ "$deleted" = 0 ]; then
    exit 0
  fi
done
