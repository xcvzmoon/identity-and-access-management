#!/bin/sh
set -eu

if ! command -v psql >/dev/null || [ -z "${PGHOST:-}" ] || [ -z "${PGDATABASE:-}" ] || [ -z "${PGUSER:-}" ]; then
  echo 'UNKNOWN: configure psql, PGHOST, PGDATABASE and PGUSER'
  exit 3
fi

export PGCONNECT_TIMEOUT=5 PGTARGETSESSIONATTRS=read-write

if ! state=$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SET statement_timeout = '5s'" -c "
  SELECT CASE
    WHEN rolsuper OR pg_catalog.pg_has_role(session_user, 'pg_use_reserved_connections', 'USAGE')
      THEN 'reserved'
    ELSE 'ordinary'
  END
  FROM pg_catalog.pg_roles
  WHERE rolname = session_user
" 2>/dev/null); then
  echo 'CRITICAL: unable to open and query a writable database session'
  exit 2
fi

case "$state" in
  ordinary) echo 'OK: writable database accepted an ordinary connection' ;;
  reserved) echo 'UNKNOWN: monitoring login can use reserved connections'; exit 3 ;;
  *) echo 'UNKNOWN: unable to confirm monitoring login privileges'; exit 3 ;;
esac
