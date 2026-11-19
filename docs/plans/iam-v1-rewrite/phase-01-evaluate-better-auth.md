# Phase 1. Evaluate Better Auth against v1

[Implementation plan](overview.md) · [Engine ownership decision](../../adr/0002-operate-the-oidc-engine.md)

## Goal

Prove the latest stable Better Auth release with a small, disposable implementation before making the rewrite depend on it. Run the IdP and a confidential console client on separate origins. Use a fresh PostgreSQL database and a reference customer client.

## Changes

- Pin Better Auth and its companion packages to the same stable release in the evaluation fixture. Check the OAuth provider, passkey plugin, and Drizzle adapter requirements. Mount `@better-auth/oauth-provider` and the JWT plugin in the temporary IdP. Exercise their protocol handlers with IAM's invitation, grant, consent, and key-management policy.
- Adapt the reference OIDC client into a console proof and a separate customer-app proof. Exercise the actual browser redirects and server-side token exchange.
- Write an evidence matrix with the pinned versions, fixture and commands, observed outcomes, and extensions needed. Record the engine decision after the checks.

## Proof checks

| Requirement                       | Passing evidence                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invitation and recovery           | New and existing users can accept an invitation for the invited email. Public signup paths, wrong-email acceptance, and expired or reused invitations fail. Prove verified-email and password-reset session behavior.                                                                                                                                                                                                                      |
| Console and hosted OIDC           | A verified user with zero memberships can sign in to the console without a consent prompt and receives a console-owned session. A customer app uses its exact callback and PKCE and presents first-time consent. The first-party exception is confined to the console registration. Prove that an admin can complete a passkey challenge at the IdP and that the management interface can bind that fresh verification to the acting user. |
| Tenant grants and live revocation | Register the same app in two organizations. Prove independent client credentials, grants, and consent. A revoked grant or ended IAM session denies the next protected request on another IdP replica. A wrong-client introspection request or unavailable live check also denies access. Verify that reauthorization or any proposed token renewal rechecks the current grant.                                                             |
| Authorization audit               | Record both an authorization after credential entry and one after SSO reuse. Confirm the app, organization, outcome, timestamp, and user ID when known. Verify that secrets and token values are excluded.                                                                                                                                                                                                                                 |
| Signing keys                      | Stage a new RSA public key and read it from both replicas before activation. Switch signing to the new key, verify still-valid tokens from the previous key, and roll back to a trusted key during the overlap.                                                                                                                                                                                                                            |

## Verification

The POC can seed the proof. See the [hosted OIDC suite](../../../apps/idp/tests/oidc.integration.test.ts), [organization invitation suite](../../../packages/auth/tests/organization-invitations.integration.test.ts), and [key rotation suite](../../../packages/auth/tests/signing-keys.integration.test.ts). The [pilot runbook](../../pilot.md#run-openid-conformance) records existing conformance coverage. Re-run the relevant cases against the proposed topology and record the results alongside the new proof checks.

Accept the engine when the evidence covers all five rows, the relevant OIDC conformance checks pass for the v1 client profile, and the design works through supported configuration or extensions. If a check fails, record the failure, the limits of the available extension points, and the next candidate or remediation. Start phase 2 after an engine is accepted.
