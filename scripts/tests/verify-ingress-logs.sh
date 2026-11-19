#!/bin/sh
set -eu

log=$(mktemp)
trap 'rm -f "$log"' EXIT
trap 'exit 1' HUP INT TERM

if ! IAM_PHASE6_TESTS=1 vp test --run --disableConsoleIntercept apps/idp/api/tests/console-session.test.ts "$@" > "$log" 2>&1; then
  echo 'Console session fixture failed. Run the fixture directly with disposable credentials for diagnostics.' >&2
  exit 1
fi

if grep -Fq 'iam-fixture-log-canary' "$log"; then
  echo 'A synthetic credential appeared in the HTTPS fixture logs.' >&2
  exit 1
fi

has_event() {
  jq -Rne --argjson expected "$1" '
    any(inputs | fromjson? | objects; . + $expected == .)
  ' < "$log" >/dev/null
}

if ! has_event '{"service":"iam-idp-api","event":"account-email-backlog","pendingDeliveries":0,"oldestPendingMs":0}'; then
  echo 'The IdP did not emit the empty SMTP backlog at startup.' >&2
  exit 1
fi

if ! has_event '{"service":"iam-idp-api","event":"api-request","path":"/api/v1/auth/reset-password/:token"}'; then
  echo 'The IdP did not log the password-reset route template.' >&2
  exit 1
fi

if ! has_event '{"service":"iam-console-api","event":"api-request","path":"/api/v1/callback","status":400}'; then
  echo 'The console API did not log the rejected callback.' >&2
  exit 1
fi

if ! has_event '{"service":"iam-idp-api","event":"api-request","method":"POST","path":"/api/v1/web/sign-in/email","status":200}'; then
  echo 'The IdP did not log the successful password sign-in POST after checking its body size.' >&2
  exit 1
fi

echo 'Console session fixture passed. API events contained route templates and no synthetic credentials.'
