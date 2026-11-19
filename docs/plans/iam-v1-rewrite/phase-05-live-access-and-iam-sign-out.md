# Phase 5. Implement live access checks and IAM sign-out

[Implementation plan](overview.md) · [Live access decision](../../adr/0004-check-app-grants-live.md)

## Changes

- Use Better Auth's authenticated introspection endpoint. Apply IAM's live grant check and return only current permissions for the registered client, subject, session, and installation.
- Adapt the reference app's protected routes to use the live check and enforce their own permission and resource ownership rules. Deny the request when the check fails or is unavailable.
- End the current IdP SSO session during IAM sign-out. Live checks must deny tokens issued against that session once sign-out commits.

## Verification

Use two IdP replicas against a disposable database. On one replica, revoke an assignment or end the user's SSO session. Route the next protected request through the other replica and expect a denial even though the access token has time left. Test an unavailable introspection endpoint and a lookup authenticated as a different client. Confirm an unrelated installation continues to work.
