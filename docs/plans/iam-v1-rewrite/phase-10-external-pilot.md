# Phase 10. Rehearse the external pilot

[Implementation plan](overview.md) · [External pilot gate](../../rewrite-scope.md#external-pilot-gate)

## Changes

- Package the IdP and console with separate image targets and ingress hosts. Set the production issuer hostname before registering external clients. Route protected requests through the supported live-check interface.
- Rehearse the deployment with at least two IdP replicas on the same issuer and database. Document migration, database restore, operator recovery, key rotation, and rollback.
- Update the integration guide and cut over workspace scripts, examples, and ingress to the new topology after the pilot checks pass.

## Verification

Run the workspace checks and the PostgreSQL, browser, and replica suites. Complete console and reference-app sign-in, tenant isolation, next-request revocation, owner recovery, and signing-key rollover and rollback. Exercise a replica outage and verify the intended behavior when IAM cannot complete a live check. Record evidence for each case, the actual issuer used, and any deferred conformance cases. Use this evidence to decide whether to open the pilot to external customers.
