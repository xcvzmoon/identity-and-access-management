# Review the IAM implementation

Begin with the deployed shape and follow one sign-in through to an app
permission check. Use the matrix to find the enforced rule, the implementation
owner, and test coverage. The references include source links for reviewers
who need to inspect a particular query or branch.

[Documentation index](README.md)

## Review order

1. Read the [architecture](architecture.md) to identify the public issuer,
   TLS boundary, server process, and database roles.
2. Follow [account activation and session handling](identity.md) and
   [application authorization](application-access.md). Check which credential
   and actor belong at each boundary.
3. Use the [HTTP allowlist](http-api.md), [management contracts](management-api.md),
   and [schema reference](database.md) to verify the inputs, stored state, and
   outputs at those boundaries.
4. Check the [test fixtures](validation.md) and [staging pilot procedure](pilot.md).
   Test evidence from a local fixture and evidence from a deployed issuer
   cover different parts of the system.

## Review matrix

| Review area                            | Invariant                                                                                                                                              | Evidence to inspect                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static UI and API isolation            | Supported HTML pages use the public shell. API requests enter the server's own route and permission checks.                                            | [Browser reference](browser.md) · [Static web suite](../apps/web/tests/static-web.integration.test.ts) · [API middleware suite](../apps/api/tests/middleware.integration.test.ts)                         |
| Public auth surface                    | Each method and path is deliberate. The gateway checks encodings, body sizes, origins, and protocol credentials at the route boundary.                 | [HTTP reference](http-api.md) · [Auth surface suite](../apps/api/tests/auth-surface.test.ts)                                                                                                              |
| Identity privacy and session lifecycle | Signup suppresses account details. Invalid sign-in cases have uniform public credential responses. Verified ownership precedes sign-in.                | [Identity lifecycle](identity.md) · [Auth suite](../apps/api/tests/auth.integration.test.ts) · [Recovery suite](../packages/auth/tests/password-recovery.integration.test.ts)                             |
| Administrator access                   | Privileged actions bind the recent passkey check to a verified session and the target organization. Owner-only actions check the role at write time.   | [Management API](management-api.md) · [Hosted passkey suite](../apps/web/tests/admin-passkeys.integration.test.ts) · [Ownership suite](../packages/auth/tests/organization-ownership.integration.test.ts) |
| Invitations and membership             | Invite acceptance uses the verified invited identity. Management and suspension are scoped to the target organization.                                 | [Admin procedures](administer.md) · [Invitation suite](../packages/auth/tests/organization-invitations.integration.test.ts)                                                                               |
| Authorization and tenant isolation     | The OAuth client maps to one private installation. The grant comes from an explicit same-organization assignment.                                      | [Application access](application-access.md) · [App access suite](../apps/api/tests/application-access.integration.test.ts) · [Hosted OIDC suite](../apps/web/tests/oidc.integration.test.ts)              |
| Registered app integration             | The SDK validates the callback and handles code exchange on the app server. App access fails closed on an inactive token or unavailable introspection. | [Reference client](../apps/web/examples/oidc-client.ts) · [Client validation suite](../apps/web/tests/oidc-client-validation.test.ts) · [Provider suite](../packages/auth/tests/oidc.integration.test.ts) |
| Machine access                         | A scoped, current key resolves to one installation. The key gives no user access.                                                                      | [Machine integration](integrate-app.md#machine-access) · [Machine suite](../apps/web/tests/machine-access.integration.test.ts)                                                                            |
| Replica consistency                    | All replicas see the same grants, sessions, and signing keys. Rotation and disablement take effect across replicas.                                    | [Replica rehearsal](pilot.md#pilot-replica-check) · [Signing-key suite](../packages/auth/tests/signing-keys.integration.test.ts)                                                                          |
| Audit and privacy operations           | Runtime writes audit records. Separate roles collect or read them. Account deletion and restore reconcile access and personal data.                    | [Audit and deletion](privacy-operations.md) · [Audit suite](../apps/api/tests/auth-audit.test.ts) · [Restore procedure](database-operations.md#backup-and-restore)                                        |

## Scope and rollout evidence

The supported external-user integration is hosted OIDC with a confidential
client. The issuer allows Authorization Code and `openid`. Machine access is
an installation lookup. Admin actions are same-origin requests from a
verified IAM session. Public client registration, an external password
exchange, and cross-organization app installation are outside this
implementation.

Before a rollout, record the issuer and deployment reference, a disposable
pilot organization and control app, the tested release, and verification
results. Redact credentials and tokens from review evidence. Treat the
repository's local conformance evidence as fixture evidence. Confirm the
staging results and check the remaining conformance scope through the
[pilot guide](pilot.md#run-openid-conformance).

When a change modifies routes, credential checks, database columns, or
privileges, update the matching reference and operational procedure. Include
the positive and denied paths in review and use the corresponding fixture
when the change affects one of the invariants above.
