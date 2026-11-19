#!/bin/sh
set -eu

if ! command -v psql >/dev/null || [ -z "${PGHOST:-}" ] || [ -z "${PGDATABASE:-}" ] || [ -z "${PGUSER:-}" ]; then
  echo 'UNKNOWN: configure psql, PGHOST, PGDATABASE and PGUSER'
  exit 3
fi

export PGCONNECT_TIMEOUT=5 PGTARGETSESSIONATTRS=read-write

if ! overdue=$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SET statement_timeout = '5s'" -c "
  SELECT EXISTS (
    SELECT 1 FROM iam_idp.rate_limits
    WHERE last_request < floor(extract(epoch FROM statement_timestamp() - interval '744 hours') * 1000)::bigint
  )
" 2>/dev/null); then
  echo 'UNKNOWN: unable to check rate-limit retention on the writable database'
  exit 3
fi

case "$overdue" in
  f) echo 'OK: rate-limit rows are within the retention deadline' ;;
  t) echo 'CRITICAL: rate-limit rows exceed 744 hours'; exit 2 ;;
  *) echo 'UNKNOWN: unexpected rate-limit retention result'; exit 3 ;;
esac
