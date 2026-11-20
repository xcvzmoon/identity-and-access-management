#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  echo "Expected trusted-public-key manifest signature expected-commit workspace" >&2
  exit 1
fi

umask 077
copy=$(mktemp)
trap 'rm -f "$copy"' EXIT
cat < "$2" > "$copy"
openssl pkeyutl -verify -rawin -pubin -inkey "$1" -in "$copy" -sigfile "$3" >&2

jq -ers --arg commit "$4" --arg workspace "$5" '
  select(length == 1) | .[0] |
  select(.complete == true and .dirty == false and
    .source_commit == $commit and ($commit | test("^[0-9a-f]{40}\\z"))) |
  select((.images | map(.workspace) | sort) ==
    ["console/api", "console/web", "idp/api", "idp/web"]) |
  select(all(.images[];
    .platform == "linux/arm64" and
    .manifest_media_type == "application/vnd.oci.image.manifest.v1+json" and
    (.buildx_manifest_digest | test("^sha256:[0-9a-f]{64}\\z")))) |
  .images[] | select(.workspace == $workspace) | .buildx_manifest_digest
' "$copy"
