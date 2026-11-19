# IAM v1 rewrite implementation plan

[Target monorepo structure](../../architecture.md#target-monorepo-structure) · [Launch scope](../../rewrite-scope.md) · [Architecture decisions](../../README.md#rewrite-decisions)

Phase 1 is complete. The evidence supports Better Auth `1.7.26` for the
rewrite. Phase 2 established the PostgreSQL baseline and verified schema
and migration isolation. Phase 3 verified invitation signup and password recovery. Phase 4 verified the OIDC issuer, installation grants, and consent through the reference app.
Phase 5 verified live access and IAM sign-out across two IdP processes.
Phase 6 verified the console session and both sign-out actions through hosted sign-in.

## Implementation boundaries

- Build on the existing Nuxt setups in `apps/idp/web` and `apps/console/web`
  and the existing Nitro setups in `apps/idp/api` and `apps/console/api`.
  Keep framework configuration local to each workspace.
- Keep schema and migration ownership in each API's `server/database/`.
  The IdP owns identity, SSO, authorization, and signing keys. The console
  owns its application sessions.
- Use Better Auth's OAuth Provider and JWT handlers. Keep IAM policy in
  the IdP API. Start from the [evaluation evidence](better-auth-evaluation.md),
  which covers the fixture and selected conformance modules.
- Start with IAM-managed accounts and confidential server-backed clients.
  Customer app backends check live access on every protected request.
  [Live access decision](../../adr/0004-check-app-grants-live.md)

## Phases

| Phase                                                                                               | Status   | Evidence required to close                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [1. Evaluate Better Auth](phase-01-evaluate-better-auth.md)                                         | Complete | Engine decision and recorded fixture results, including selected discovery and PKCE conformance checks.                                                            |
| [2. Verify the workspaces and establish database ownership](phase-02-establish-apps-and-storage.md) | Complete | Both migration sets apply to fresh PostgreSQL. Each API's runtime role is denied reads and writes in the other schema. Required settings are validated at startup. |
| [3. Build invitation signup and recovery](phase-03-invitation-signup-and-recovery.md)               | Complete | New and existing invitees join with the verified invited email. Password reset invalidates prior IAM sessions.                                                     |
| [4. Build the OIDC issuer and app grants](phase-04-oidc-issuer-and-app-grants.md)                   | Complete | A reference app signs in through the issuer. Two installations of the same app have independent clients, grants, and consent.                                      |
| [5. Implement live checks and IAM sign-out](phase-05-live-access-and-iam-sign-out.md)               | Complete | The next protected request is denied after revocation or IAM sign-out across two IdP processes, or when the live check is unavailable.                             |
| [6. Build the console OIDC session](phase-06-console-oidc-session.md)                               | Complete | A verified user with zero memberships can open their account. The console owns its session and offers both sign-out actions.                                       |
| [7. Build administration and owner recovery](phase-07-administration-and-owner-recovery.md)         | Planned  | An operator onboards an owner. Admin actions enforce tenant scope and step-up. Locked-out owner recovery is audited.                                               |
| [8. Verify authorization audit and retention](phase-08-authorization-audit.md)                      | Planned  | Authorization outcomes and owner recovery are traceable. Audit access, retention, and redaction pass checks.                                                       |
| [9. Automate signing-key rotation](phase-09-signing-key-rotation.md)                                | Planned  | Two IdP processes observe staged publication, activation, overlap, and rollback.                                                                                   |
| [10. Rehearse the external pilot](phase-10-external-pilot.md)                                       | Planned  | A packaged deployment passes the pilot checks on at least two IdP replicas, with runbooks and recorded evidence.                                                   |

Phase 3 uses a fixture invitation. Phase 7 adds the operator workflow that
creates invitations for first owners. Phase 4 adds authorization events and
the shared signing-key store. Phase 8 verifies the audit trail built in
Phases 4 and 7. Phase 9 automates rotation of the keys used by the issuer.
Phase 10 checks the integrated deployment with its final ingress and
operating procedures.

## Verification

Run the workspace checks and the relevant PostgreSQL, browser, and replica
fixtures for each phase. Record fixture results and skips separately.
[Validation guide](../../validation.md)
