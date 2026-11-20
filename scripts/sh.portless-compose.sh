#!/bin/sh
set -eu

IDP_ORIGIN=$(portless get --no-worktree idp.iam)
CONSOLE_ORIGIN=$(portless get --no-worktree console.iam)
IDP_AUTHORITY=${IDP_ORIGIN#https://}
CONSOLE_AUTHORITY=${CONSOLE_ORIGIN#https://}
IDP_HOST=${IDP_AUTHORITY%:*}
CONSOLE_HOST=${CONSOLE_AUTHORITY%:*}

if [ "$IDP_HOST" != 'idp.iam.localhost' ] || [ "$CONSOLE_HOST" != 'console.iam.localhost' ]; then
  echo 'Start the Portless proxy with HTTPS and the localhost TLD.' >&2
  exit 1
fi

export IDP_ORIGIN CONSOLE_ORIGIN IDP_AUTHORITY CONSOLE_AUTHORITY IDP_HOST CONSOLE_HOST
exec portless compose -p iam --env-file .env.portless "$@"
