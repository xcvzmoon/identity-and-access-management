#!/bin/sh
set -eu

marker=/var/lib/iam-retention/last-success
max_age_seconds=93600

if ! completed=$(stat --format=%Y -- "$marker" 2>/dev/null) || [ ! -f "$marker" ]; then
  echo "CRITICAL: retention completion marker unavailable"
  exit 2
fi

now=$(date +%s)
age=$((now - completed))
if [ "$age" -lt 0 ] || [ "$age" -gt "$max_age_seconds" ]; then
  echo "CRITICAL: retention completion age is ${age}s"
  exit 2
fi

echo "OK: retention completed ${age}s ago"
