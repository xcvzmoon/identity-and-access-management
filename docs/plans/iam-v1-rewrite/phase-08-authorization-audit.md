# Phase 8. Verify authorization audit and retention

[Implementation plan](overview.md)

## Changes

- Review the IdP authorization events added in Phase 4 and the recovery
  events added in Phase 7. Each authorization outcome records the app
  registration, organization, timestamp, outcome, and user ID when known.
- Restrict access to the audit store or sink. Define who can read events
  and how long they are retained. Exclude credentials, authorization
  codes, cookies, and token values from events and ingress logs.

## Verification

Compare records for authorization after password entry, SSO reuse, and
denied authorization. Verify the app and organization come from the
resolved registration. Check the recovery trail and exercise audit
access and retention under the intended roles. Inspect event payloads
and logs for secret and token redaction.

## Results

Chromium completed password sign-in and reused the same SSO session. Each
authorization produced a separate approval for the registered client,
organization, and user. The approval was visible before code exchange.
The second installation's grant denial and consent denials carried its
own organization ID. Exchange after revocation recorded a denied exchange.

A security reviewer read the operator, organization, case reference, timestamp,
and invitation outcome for a completed owner recovery. PostgreSQL role checks
verified append-only IdP access, reviewer reads, and restricted purge execution.
The purge removed expired events from both tables, kept recent rows, and
preserved duplicate-case rejection after removing the original recovery event.

The HTTPS fixture found no synthetic credentials in its proxy and upstream logs.
Under forced rendering failures, both production web builds logged the HTTP
status and returned generic HTML or JSON. Normal 404 responses continued to use
Nuxt rendering. Run the web servers with `NODE_ENV=production` and repeat the
log checks at the deployed ingress in Phase 10.
[Verification commands](../../validation.md#audit-access-and-retention) ·
[Retention and deployment](../../local.md#audit-retention)
