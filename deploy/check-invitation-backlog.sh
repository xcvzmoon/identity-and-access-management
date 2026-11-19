#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || ! command -v psql >/dev/null || [ -z "${PGHOST:-}" ] || [ -z "${PGDATABASE:-}" ] || [ -z "${PGUSER:-}" ]; then
  echo 'UNKNOWN: supply a delivery deadline in milliseconds and configure psql, PGHOST, PGDATABASE and PGUSER'
  exit 3
fi

case "$1" in
  ''|0*|*[!0-9]*)
    echo 'UNKNOWN: the deadline must be a positive integer without leading zeros'
    exit 3 ;;
esac
if [ "${#1}" -gt 15 ]; then
  echo 'UNKNOWN: the deadline may contain up to 15 digits'
  exit 3
fi

export PGCONNECT_TIMEOUT=5 PGTARGETSESSIONATTRS=read-write
if ! overdue=$(psql -XqAtw -v ON_ERROR_STOP=1 -v deadline="$1" 2>/dev/null <<'SQL'
SET statement_timeout = '5s';
SELECT coalesce(string_agg(queue, ',' ORDER BY queue) FILTER (WHERE oldest_pending_ms > :'deadline'::bigint), 'none')
FROM iam_idp.invitation_delivery_backlog();
SQL
); then
  echo 'CRITICAL: unable to read the invitation queues on the writable database'
  exit 2
fi

case "$overdue" in
  none) echo 'OK: invitation queues are within the delivery deadline' ;;
  owner|member|member,owner) echo "CRITICAL: invitation delivery deadline exceeded for $overdue"; exit 2 ;;
  *) echo 'UNKNOWN: unexpected invitation backlog result'; exit 3 ;;
esac
