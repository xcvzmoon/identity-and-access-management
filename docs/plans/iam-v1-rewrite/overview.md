# IAM v1 rewrite implementation plan

[Launch scope](../../rewrite-scope.md) · [Architecture decisions](../../README.md#rewrite-decisions)

IAM will operate one OIDC issuer per deployment. The rewrite moves hosted sign-in and token issuance to the IdP origin. The console becomes a confidential OIDC client with its own session. Customer apps receive an independent registration and grant for each installation.

## Constraints

- Use the latest stable Better Auth release and matching `@better-auth` packages at the start of phase 1. Pin the exact versions for the evaluation. Keep the engine decision open until the [evaluation](phase-01-evaluate-better-auth.md) passes. If a required behavior depends on a protocol fork or a weaker security guarantee, record the gap and evaluate another self-hostable engine against the same tests.
- Build two standalone Nuxt apps, `apps/idp` and `apps/console`. Share components and styles through explicit imports. Keep the issuer, session handling, and management rules with the apps that own them.
- Use a separate PostgreSQL database with fresh fixtures. Each app owns its schema, migrations, and runtime database role. The IdP owns credentials, SSO, customer app registrations, and app grants. The console owns console sessions.
- Use live checks on protected customer app requests. This accepts a runtime dependency on the IdP to meet the agreed next-request revocation guarantee. A local token check or cached introspection response would lengthen the revocation window. See the [live access decision](../../adr/0004-check-app-grants-live.md).
- Start with IAM-managed accounts and server-backed web clients. Customer federation and machine installation lookup enter scope when a launch app requires them. Public client types can be evaluated for a later release.

## Phases

| Phase                                                                                 | Evidence required to move on                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [1. Evaluate Better Auth](phase-01-evaluate-better-auth.md)                           | A recorded engine decision supported by a working proof of the accepted v1 requirements.                                         |
| [2. Establish apps and database ownership](phase-02-establish-apps-and-storage.md)    | Both apps start from fresh fixtures and their runtime roles stay within their schemas.                                           |
| [3. Build invitation signup and recovery](phase-03-invitation-signup-and-recovery.md) | New and existing users can accept invitations for the correct email. Recovery preserves the verified-email and session rules.    |
| [4. Move the OIDC issuer and app grants](phase-04-oidc-issuer-and-app-grants.md)      | A reference app signs in through the new issuer. Two organizations can use separate installations of the same app.               |
| [5. Implement live checks and IAM sign-out](phase-05-live-access-and-iam-sign-out.md) | A revoked grant or ended SSO session denies the next protected request across replicas.                                          |
| [6. Build the console OIDC session](phase-06-console-oidc-session.md)                 | A verified user can open their account through OIDC, including when they have no membership.                                     |
| [7. Move administrative workflows](phase-07-administration-and-owner-recovery.md)     | Operators can onboard an owner, admins can manage their own organization, and an operator can recover a locked-out organization. |
| [8. Record app authorization outcomes](phase-08-authorization-audit.md)               | Authorization events cover both password and SSO paths without exposing secrets.                                                 |
| [9. Automate signing-key rotation](phase-09-signing-key-rotation.md)                  | Two replicas publish, activate, and roll back the same key across a staged rotation.                                             |
| [10. Rehearse the external pilot](phase-10-external-pilot.md)                         | The full workflow passes on at least two IdP replicas, with an operator runbook and evidence.                                    |

Phases 3 through 9 may reuse proven POC modules where they satisfy the new interfaces. Keep each change independently testable. Switch ingress, documentation, and workspace entry points to the new apps at the pilot cutover.

## Verification

Run `vp check`, `vp test --run`, `vp run typecheck`, and `vp run build` against the implementation. Run the designated PostgreSQL, browser, and two-replica suites with fixture variables set. Record results separately from skipped tests. Use the [current fixture guide](../../validation.md#integration-tests) to locate POC coverage and adapt it to the new origins.

Use the `better-auth-best-practices`, `better-auth-security-best-practices`, and `security-audit` skills for engine and session work. Apply `nuxt`, `nitro`, and `vue-best-practices` to app work, and `drizzle-migrations` and `drizzle-orm-rc` to schema changes. Use `docker-build-strategies` and `docker-compose-patterns` for deployment. Apply the repository's `ts-best-practices`, `xcvzmoon-code-conventions`, and `testing` skills throughout.
