# Phase 10. Rehearse the external pilot

[Implementation plan](overview.md) · [External pilot gate](../../rewrite-scope.md#external-pilot-gate)

## Changes

- Replace the POC container targets and Compose paths with packaging for
  the four workspaces. Configure ingress for the IdP issuer and the
  separate console origin. Pin the production issuer hostname before
  registering external clients.
- Deploy at least two IdP API replicas behind one issuer. Use the same
  database and signing-key state. Document migrations, backup and
  restore, operator recovery, key rotation, and rollback.
- Publish v1 integration and deployment instructions for the supported
  client profile. Rehearse with the rewrite database and fixtures.
  The old application workspaces were already retired.

## Verification

Run the workspace, PostgreSQL, browser, and replica checks on the pilot
setup. Complete console and reference-app sign-in, tenant isolation,
next-request revocation, IAM sign-out, owner recovery, and signing-key
rollover and rollback. Exercise a replica outage, an unavailable live
check, and database restore. Record evidence for each case, the actual
issuer used, and the conformance scope. The Phase 1 results cover
discovery and the selected confidential-client PKCE case. Review the
remaining Basic OP conformance coverage before opening the pilot.
