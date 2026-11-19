# Phase 5. Implement live access checks and IAM sign-out

[Implementation plan](overview.md) · [Live access decision](../../adr/0004-check-app-grants-live.md)

## Changes

- Expose Better Auth's authenticated introspection endpoint in
  `apps/idp/api` with IAM's live grant check. Evaluate current access for
  the registered client, user, installation, and IAM session.
- Check live access on every protected request in the reference app's
  backend. Enforce the returned permissions and local resource rules.
  Deny access if the check fails or is unavailable.
- Provide IAM sign-out in the IdP flow. End the current SSO session so
  subsequent checks deny tokens tied to that session.

## Verification

Start two separate IdP API processes behind one test issuer with shared
disposable PostgreSQL storage. Revoke an app grant or end an IAM session
through one process. Verify the next protected request is denied when
introspection reaches the other process and the token is still within its
lifetime. Test permission changes, an unavailable endpoint, credentials
for a different client, and continued access to an unrelated installation.
Phase 10 repeats the checks on the packaged deployment.
