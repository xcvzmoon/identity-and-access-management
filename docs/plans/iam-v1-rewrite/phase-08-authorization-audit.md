# Phase 8. Record app authorization outcomes

[Implementation plan](overview.md)

## Changes

- Record an outcome at the IdP's app authorization decision. Include the app registration, organization, timestamp, outcome, and the user ID when known. Record reuse of SSO through the same event path as interactive login.
- Use a restricted audit store or sink. Define who can read it and how long to retain events before the pilot. Keep credentials, authorization codes, cookies, and token values out of events and ingress logs.

## Verification

Compare records for interactive login, SSO reuse, and denied authorization. Confirm that app and organization IDs come from the resolved registration. Inspect the event payload and logs for redaction. Verify that runtime and operator access to audit data matches the deployment roles.
