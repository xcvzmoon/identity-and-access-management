# Better Auth evaluation evidence

**Decision.** Adopt Better Auth for the v1 rewrite. Version `1.7.26` passed the application checks with both PostgreSQL adapters and the selected OpenID Foundation discovery and PKCE modules. The two-replica deployment rehearsal remains the external pilot gate.

## Evaluation setup

The fixture pins Better Auth, OAuth Provider, Passkey, and the Drizzle adapter to `1.7.26`. That was the latest stable release on 19 November 2026. The fixture has its own lockfile. The product app workspaces have their own dependency catalog. [Better Auth 1.7.26 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.26)

Keep one resolved instance of `@better-auth/core` across the IdP and its plugins. An initial pnpm install resolved separate copies through different `jose` peer versions. Aligning the fixture with Better Auth's `jose` `6.2.17` pin resolved the type and module mismatch.

The run uses fresh PostgreSQL 18.6 storage, two Better Auth instances with separate connection pools, and Chromium 159. The IdP, console, and two Reports installations have separate HTTPS origins. The replicas run in one local process with a shared issuer and database. The console exchanges codes on its server and keeps its own host-only session cookie.

Better Auth's OAuth Provider and JWT plugins serve discovery, authorization, consent, token exchange, introspection, and JWKS. IAM supplies invitation eligibility, per-installation grant checks, audit events, and staged signing keys through configuration, hooks, and the handler that applies live policy to introspection. The checked-in fixture uses the built-in PostgreSQL adapter. The Drizzle run used a disposable copy of the same fixture. [OAuth Provider configuration](https://better-auth.com/docs/plugins/oauth-provider) · [JWT adapter configuration](https://better-auth.com/docs/plugins/jwt#custom-adapter)

## Local evidence

| Requirement                       | Observed result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation and recovery           | Public signup was unavailable. The fixture rejected signup for the wrong or expired invitation. Sign-in required a verified email. New and existing accounts accepted invitations for their email. Wrong-email, expired, and replayed acceptance failed. Password reset invalidated the previous IAM session, old password, and reset link.                                                                                                                                                                                                     |
| Console and hosted OIDC           | A verified user with zero memberships signed in through the console and received a console-owned session without a consent prompt. The client validated the signed RS256 ID token and used state, nonce, and S256 PKCE. The provider rejected a missing PKCE challenge and an unregistered callback. Reports displayed first-time consent for both installations. A Chromium WebAuthn ceremony elevated one owner session. Another session for the same user and an expired step-up both failed the check.                                      |
| Tenant grants and live revocation | The Reports installations received separate credentials. An assignment for North granted no access to South. The second IdP instance denied introspection by the wrong client. It denied the next protected request after a grant change or revocation and after IAM sign-out. The app denied access when introspection was unavailable. Changing the approved grant required renewed consent. Revocation between code issuance and exchange caused `invalid_grant`. The fixture enables the authorization-code grant and omits refresh tokens. |
| Authorization audit               | The fixture recorded customer approval after password entry, approval after SSO reuse, and authorization denied by the grant policy. The tested records contained the app registration, organization, user ID, outcome, and timestamp. The fixture records approval when the code-exchange grant check succeeds.                                                                                                                                                                                                                                |
| Signing keys                      | Both instances published the staged public key while continuing to sign with the original key. Both switched to the replacement and could roll back. Tokens from both keys verified during overlap. The test used encrypted private keys in PostgreSQL and Better Auth's native JWKS and signing handlers.                                                                                                                                                                                                                                      |

## Run the fixture

Run these commands from the repository root with Vite+, PostgreSQL client and server tools, and OpenSSL installed. The fixture creates its database and TLS material under a temporary directory and removes them on exit.

```sh
pnpm -C evaluations/better-auth install --frozen-lockfile --ignore-scripts
pnpm -C evaluations/better-auth exec playwright install chromium
vp -C evaluations/better-auth run evaluate
vp -C evaluations/better-auth run typecheck
```

## OpenID Foundation conformance

Suite `release-v5.3.4` returned `FINISHED / PASSED` for both modules. Run these against the fixture's HTTPS discovery URL with a statically registered web client and the suite's exact callback URL. Use `client_secret_basic`, response type `code`, and the default response mode for the PKCE module. [OpenID Provider conformance instructions](https://openid.net/certification/connect_op_testing/)

| Module                                          | Result | Local run ID      |
| ----------------------------------------------- | ------ | ----------------- |
| `oidcc-discovery-endpoint-verification`         | Passed | `BTP3y43lCmYhApB` |
| `oidcc-ensure-request-with-valid-pkce-succeeds` | Passed | `MHUtlz64XOSypUg` |

These results cover discovery and the selected confidential-client PKCE flow. Full Basic OP conformance remains open.

## Drizzle adapter

The full browser fixture passed with `@better-auth/drizzle-adapter` `1.7.26`, Drizzle ORM and Kit `1.0.0-rc.5-5935859`, and the PostgreSQL `pg` driver. Both IdP instances used the Drizzle adapter with transactions enabled.

Generate the PostgreSQL tables for the JWT, OAuth Provider, and Passkey configuration with `auth@1.7.26 generate --adapter drizzle --dialect postgresql`. The generator emits legacy `relations()` declarations. Drizzle RC 5 rejected them with `relations is not a function`. The fixture retained the generated table definitions and removed the legacy relations. Run `drizzle-kit generate` against those definitions. Apply the generated SQL to the empty fixture database in place of the built-in migrations, then run the same browser checks with `drizzleAdapter` and that schema. Phase 2 should use relation definitions compatible with the pinned Drizzle RC wherever the runtime needs them.

## Console step-up

Better Auth's passkey verification creates a new IdP session. The fixture checks that the verified credential belongs to the acting user, then binds elevation to that new session. The console receives the permission through authenticated introspection after reauthorizing with the new session. Its previous token, a different session for the same owner, and an expired step-up all fail the management request.
