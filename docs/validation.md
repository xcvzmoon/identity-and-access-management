# Validate changes

[Documentation index](README.md) · [Local setup](local.md)

## Workspace checks

Configure both API `.env` files, then run these commands from the repository
root. [Local setup](local.md#database-setup)

```sh
vp check
vp test --run
vp run typecheck
vp run build
```

The root suite includes workspace discovery checks. For a local startup
check, open both web scaffold pages and request `/api/v1/hello` from each API.
The APIs need a reachable database and their runtime credentials.
[Local database setup](local.md#database-setup)

## Integration tests

The [Better Auth evaluation](plans/iam-v1-rewrite/better-auth-evaluation.md#run-the-fixture)
has its own dependencies and disposable database. Its results support the
engine choice. The v1 workspaces need their own verification as they gain
the database and auth flows.

| Fixture                   | Required checks                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh PostgreSQL database | Apply each API's migrations with its own credentials. Check runtime access within each schema and denied reads and writes across schemas. [Phase 2](plans/iam-v1-rewrite/phase-02-establish-apps-and-storage.md)         |
| Browser and reference app | Verify invitation acceptance, recovery, OIDC, consent, tenant isolation, and console sessions. [Phases 3 to 6](plans/iam-v1-rewrite/overview.md#phases)                                                                  |
| Two IdP processes         | Use one test issuer and database. Revoke an app grant or end SSO through one process, then verify the next protected request through the other. [Phase 5](plans/iam-v1-rewrite/phase-05-live-access-and-iam-sign-out.md) |
| Packaged pilot deployment | Test two IdP replicas, owner recovery, rotation and rollback, and backup and restore. [Phase 10](plans/iam-v1-rewrite/phase-10-external-pilot.md)                                                                        |

Run integration tests against disposable data. Record which checks ran, which
were skipped, and which fixture and deployment each result covers.

### Invitation signup and recovery

Create a disposable local PostgreSQL database named `iam_phase3_test`. Apply
the IdP migrations with its migrator credentials. Start Mailpit on loopback
and point the IdP's SMTP settings at its SMTP port (default `1025`). Start
the IdP API with the runtime role and the settings for that database.
[IdP setup](local.md#idp-account-flows)

From the repository root, export the same IdP runtime settings used by the
server and run the suite. Set the URLs to the loopback endpoints for the
running API and Mailpit's HTTP interface.

```sh
IAM_PHASE3_TESTS=1 \
IAM_PHASE3_API=http://127.0.0.1:65430 \
IAM_PHASE3_MAILPIT=http://127.0.0.1:8025 \
vp test --run apps/idp/api/tests/invitations.test.ts
```

Each run seeds new organizations, invitations and email addresses. The
tests follow links from delivered messages, check membership after concurrent
acceptance, and use two session cookies to verify password reset revocation.
Discard the fixture database and mailbox when finished.
