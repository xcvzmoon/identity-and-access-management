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
