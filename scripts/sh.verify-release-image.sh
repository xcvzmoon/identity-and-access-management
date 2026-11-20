#!/bin/sh
set -eu

if [ "$#" -ne 7 ]; then
  echo "Expected trusted-public-key manifest signature approved-commit workspace repository passing-receipt" >&2
  exit 1
fi

umask 077
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
scratch=$(mktemp -d)
container=''
cleanup() {
  if [ -n "$container" ]; then
    docker rm -v "$container" >/dev/null
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

cat < "$2" > "$scratch/manifest"
cat < "$7" > "$scratch/receipt"
digest=$(sh "$script_dir/sh.verify-release-manifest.sh" "$1" "$scratch/manifest" "$3" "$4" "$5")
receipt_hash=$(openssl dgst -sha256 -r "$scratch/receipt")
if ! jq -e --arg hash "${receipt_hash%% *}" '.release_receipt_sha256 == $hash' "$scratch/manifest" >/dev/null; then
  echo "Passing receipt digest differs from the signed manifest" >&2
  exit 1
fi
expected=$(jq -ers --arg commit "$4" --arg workspace "$5" '
  select(length == 1) | .[0] |
  select(.revision == $commit and .dirty == false and .auditAccess == "passed" and
    .ingressLogs == "passed" and .passedCases == 10 and
    (.phases | sort) == ["3", "4", "5", "6", "7", "9", "rotation"] and
    (.bundleSha256 | keys) == ["console/api", "console/web", "idp/api", "idp/web"] and
    all(.bundleSha256[]; type == "string" and test("^[0-9a-f]{64}\\z"))) |
  .bundleSha256[$workspace]
' "$scratch/receipt")

reference="$6@$digest"
docker pull --platform linux/arm64 "$reference" >&2
platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$reference")
if [ "$platform" != 'linux/arm64' ]; then
  echo "Expected a Linux arm64 image for $5" >&2
  exit 1
fi
container=$(docker create --pull never --platform linux/arm64 "$reference")
docker cp "$container:/app/.output" "$scratch/bundle"
actual=$(node "$script_dir/tests/ts.release-inputs.ts" "$scratch/bundle")
if [ "$actual" != "$expected" ]; then
  echo "Packaged $5 bundle differs from the passing release receipt" >&2
  exit 1
fi

printf '%s\n' "$reference"
