# Phase 1. Evaluate Better Auth against v1

[Implementation plan](overview.md) · [Engine ownership decision](../../adr/0002-operate-the-oidc-engine.md)

## Outcome

Complete. Adopt Better Auth `1.7.26` for the rewrite. Its OAuth Provider
and JWT plugins provide the protocol handlers. IAM adds account invitation
rules, installation grants, live checks, audit events, and key activation
using the integration points exercised by the fixture.
[Evaluation evidence and reproduction commands](better-auth-evaluation.md)

## Proof checks

| Requirement                       | Fixture coverage                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation and recovery           | Verified invitation signup and acceptance, privacy checks, and password reset session invalidation                                                                     |
| Console and hosted OIDC           | Separate origins and a console-owned session, zero-membership account access, confidential PKCE, customer consent, and session-bound passkey step-up                   |
| Tenant grants and live revocation | Two installations with separate clients, grant and consent checks, next-request denial after revocation or IAM sign-out, and denial when the live check is unavailable |
| Authorization audit               | Approval after password entry, approval after SSO reuse, and denial by grant policy                                                                                    |
| Signing keys                      | RS256 signing, staged public key publication, activation, overlap, and rollback                                                                                        |

## Evidence carried into the rewrite

The disposable PostgreSQL and browser fixture ran two Better Auth
instances with separate connection pools in one process. It passed both
the built-in PostgreSQL adapter and the tested Drizzle adapter
configuration. The OpenID Foundation discovery and selected
confidential-client PKCE modules passed.

Phase 2 verifies the four workspace scaffolds and database ownership.
Phase 5 verifies live access with separate IdP processes. Phase 10
rehearses the packaged deployment and reviews the remaining Basic OP
conformance coverage.
