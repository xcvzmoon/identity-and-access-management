#!/bin/sh
set -eu

if [ "$#" -ne 2 ] || [ ! -r "$2" ] || ! command -v curl >/dev/null || ! command -v jq >/dev/null; then
  echo 'UNKNOWN: supply an HTTPS introspection endpoint, a readable netrc file, curl and jq'
  exit 3
fi

if ! response=$(curl --disable --globoff --silent --proto '=https' --max-time 8 --max-filesize 16384 \
  --basic --netrc-file "$2" --data 'token=iam-monitor-inactive&token_type_hint=access_token' \
  --write-out '\n%{http_code}' --url "$1"); then
  echo 'CRITICAL: introspection request failed'
  exit 2
fi

if ! printf '%s\n' "$response" | jq -es 'length == 2 and .[1] == 200 and (.[0] | type == "object" and .active == false)' >/dev/null 2>&1; then
  echo 'CRITICAL: introspection did not confirm an inactive token'
  exit 2
fi

echo 'OK: introspection confirmed an inactive token'
