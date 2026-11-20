#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || ! command -v jq >/dev/null; then
  echo 'UNKNOWN: supply the delivery deadline in milliseconds and install jq'
  exit 3
fi

if ! jq -en --arg deadline "$1" '$deadline | test("^[1-9][0-9]{0,14}$")' >/dev/null; then
  echo 'UNKNOWN: supply a positive integer delivery deadline in milliseconds (up to 15 digits)'
  exit 3
fi

if ! state=$(jq -ers --argjson deadline "$1" '
  def count: type == "number" and . >= 0 and . == floor;
  if length != 1 then "missing"
  else .[0] |
    if .service != "iam-idp-api" or .event != "account-email-backlog"
       or (.pendingDeliveries | count | not) or (.oldestPendingMs | count | not)
       or (.pendingDeliveries == 0 and .oldestPendingMs != 0) then "invalid"
    else
      (.timestamp | capture("^(?<whole>[0-9T:-]+)\\.(?<ms>[0-9]{3})Z$")) as $time |
      (now - (($time.whole + "Z" | fromdateiso8601) + ($time.ms | tonumber) / 1000)) as $age |
      if $age < 0 or $age > 180 then "stale"
      elif .oldestPendingMs > $deadline then "overdue"
      else "ok" end
    end
  end
' 2>/dev/null); then
  state=invalid
fi

case "$state" in
  ok) echo 'OK: SMTP backlog is within the delivery deadline' ;;
  overdue) echo 'CRITICAL: pending SMTP delivery exceeded the deadline'; exit 2 ;;
  stale) echo 'CRITICAL: SMTP backlog sample is stale or future-dated'; exit 2 ;;
  *) echo 'CRITICAL: latest SMTP backlog sample is unavailable or invalid'; exit 2 ;;
esac
