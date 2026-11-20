#!/bin/sh
set -eu

if ! command -v psql >/dev/null || [ -z "${PGHOST:-}" ] || [ -z "${PGDATABASE:-}" ] || [ -z "${PGUSER:-}" ]; then
  echo 'UNKNOWN: configure psql, PGHOST, PGDATABASE and PGUSER'
  exit 3
fi

export PGCONNECT_TIMEOUT=5 PGTARGETSESSIONATTRS=read-write

if ! overdue=$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SET statement_timeout = '5s'" -c "
  SELECT EXISTS (
    SELECT 1 FROM iam_idp.sign_in_events
    WHERE created_at < statement_timestamp() - interval '744 hours'
  ), EXISTS (
    SELECT 1 FROM iam_idp.sign_in_counts
    WHERE day < (statement_timestamp() AT TIME ZONE 'UTC')::date - 90
  )
" 2>/dev/null); then
  echo 'UNKNOWN: unable to check sign-in retention on the writable database'
  exit 3
fi

case "$overdue" in
  'f|f') echo 'OK: sign-in events and daily counts are within their retention deadlines' ;;
  't|f') echo 'CRITICAL: sign-in events exceeded their retention deadline'; exit 2 ;;
  'f|t') echo 'CRITICAL: daily sign-in counts exceeded their retention deadline'; exit 2 ;;
  't|t') echo 'CRITICAL: sign-in events and daily counts exceeded their retention deadlines'; exit 2 ;;
  *) echo 'UNKNOWN: unexpected sign-in retention result'; exit 3 ;;
esac
