#!/bin/sh
set -eu

log=$(mktemp)
trap 'rm -f "$log"' EXIT
trap 'exit 1' HUP INT TERM

if ! IAM_PHASE6_TESTS=1 vp test --run --disableConsoleIntercept apps/idp/api/tests/console-session.test.ts > "$log" 2>&1; then
  echo 'Console session fixture failed. Run the fixture directly with disposable credentials for diagnostics.' >&2
  exit 1
fi

if grep -Fq 'iam-fixture-log-canary' "$log"; then
  echo 'A synthetic credential appeared in the HTTPS fixture logs.' >&2
  exit 1
fi

echo 'Console session fixture passed. No synthetic credentials appeared in the HTTPS fixture logs.'
