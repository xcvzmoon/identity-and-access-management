# IAM v1 scope

| Area             | Supported behavior                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts         | IAM-managed sign-in, email verification, invitation-based signup, password recovery, and a console account page for any verified user                                        |
| Organizations    | Operator-assisted onboarding, verified membership invitations, tenant-scoped administration, passkey step-up, and audited owner recovery                                     |
| App integrations | Confidential server-backed OIDC clients, Authorization Code with S256 PKCE, exact HTTPS callbacks, one registration per installation, and consent tied to the approved grant |
| Authorization    | Live grant and SSO checks on protected requests, per-installation roles and permissions, and denial if IAM cannot complete the check                                         |
| Sessions         | Separate IdP and app sessions, with local sign-out and an issuer confirmation flow for IAM sign-out                                                                          |
| Operations       | Separate database migration and runtime roles, authorization audit, 90-day audit retention, staged signing-key rotation, and two-replica packaging                           |

The rewrite uses a fresh database with new identities, organizations, app registrations, and grants. Customer identity federation and installation machine lookup are outside the supported v1 contract. [Architecture](architecture.md) · [Client integration](client-integration.md)

The packaged deployment completed a local rehearsal. External onboarding requires a production issuer, release evidence for that deployment, and a decision on the remaining Basic OP conformance coverage. [Pilot release checks](pilot.md#decide-whether-to-open-the-pilot) · [Recorded rehearsal](history.md#phase-10--rehearse-the-packaged-pilot-locally)
