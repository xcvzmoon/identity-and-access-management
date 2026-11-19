# Validate changes

[Documentation index](README.md) · [Local setup](local.md)

## Workspace checks

Run these commands from the repository root.

```sh
vp check
vp test --run
vp run typecheck
vp run build
```

The root suite includes workspace discovery checks. For a local startup
check, open both web scaffold pages and request `/api/hello` from each API.
These checks cover the scaffolds and workspace tooling.

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
