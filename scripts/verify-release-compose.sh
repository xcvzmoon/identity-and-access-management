#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  echo 'Expected trusted-public-key manifest signature approved-commit passing-receipt' >&2
  exit 1
fi

: "${IDP_API_REPOSITORY:?}" "${IDP_WEB_REPOSITORY:?}" "${CONSOLE_API_REPOSITORY:?}" "${CONSOLE_WEB_REPOSITORY:?}"
umask 077
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
trap 'exit 1' HUP INT TERM
cat < "$1" > "$scratch/key"
cat < "$2" > "$scratch/manifest"
cat < "$3" > "$scratch/signature"
cat < "$5" > "$scratch/receipt"
commit=$4

verify() {
  sh "$script_dir/verify-release-image.sh" "$scratch/key" "$scratch/manifest" \
    "$scratch/signature" "$commit" "$1" "$2" "$scratch/receipt"
}

idp_api=$(verify idp/api "$IDP_API_REPOSITORY")
idp_web=$(verify idp/web "$IDP_WEB_REPOSITORY")
console_api=$(verify console/api "$CONSOLE_API_REPOSITORY")
console_web=$(verify console/web "$CONSOLE_WEB_REPOSITORY")

service() {
  printf '  %s:\n    build: !reset null\n    image: "%s"\n    pull_policy: never\n' "$1" "$2"
}

echo 'services:'
service idp-api-1 "$idp_api"
service idp-api-2 "$idp_api"
service idp-web "$idp_web"
service console-api "$console_api"
service console-web "$console_web"
