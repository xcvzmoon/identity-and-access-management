#!/bin/sh
set -eu

cd "$(dirname "$0")"
scratch=$(mktemp -d /tmp/iam-better-auth-eval.XXXXXXXX)

cleanup() {
  if [ -f "$scratch/db/postmaster.pid" ]; then
    pg_ctl -D "$scratch/db" -w stop -m fast > /dev/null
  fi
  rm -rf -- "$scratch"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

initdb -D "$scratch/db" -A trust --no-locale -E UTF8 -U iam_eval > /dev/null
pg_ctl -D "$scratch/db" -l "$scratch/postgres.log" -o "-h '' -p 56427 -k $scratch" -w start > /dev/null
createdb -h "$scratch" -p 56427 -U iam_eval iam_eval
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=IAM evaluation' \
  -addext 'subjectAltName=DNS:localhost,DNS:console.localhost,DNS:north.localhost,DNS:south.localhost,IP:127.0.0.1' \
  -keyout "$scratch/tls-key.pem" -out "$scratch/tls-cert.pem" 2> "$scratch/openssl.log" || {
    cat "$scratch/openssl.log" >&2
    exit 1
  }
NODE_EXTRA_CA_CERTS="$scratch/tls-cert.pem" IAM_EVAL_PG_SOCKET="$scratch" vpx evaluate.ts
