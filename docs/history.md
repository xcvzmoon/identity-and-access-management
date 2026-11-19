# IAM project history

The repository began as a single web and API workspace. The v1 rewrite established a dedicated OpenID Connect (OIDC) issuer and a separate console, rehearsed a two-replica pilot locally, and added Portless as the named HTTPS development entry point. The dates and revisions below identify the work and the scope of the recorded checks.

## 10–18 November 2026 · Repository and prototype

- The initial repository added Vite+, repository conventions, lint and formatting rules, native Git hooks, and release tooling. The workspace gained a Nitro API, a Nuxt web app, PostgreSQL and Drizzle support, shared environment validation, and UUIDv7 and audit-column helpers.
- The prototype wired Better Auth email and password authentication to the API and added SSR sign-in, account pages, and sealed Nuxt web sessions. Local environment templates, database initialization, and Docker packaging made it possible to run the prototype end to end.
- On 19 November the prototype added private installations, organization roles, live grant resolution, machine keys, administrator passkeys, a confidential reference client, and operational proof for signing keys, audit, and rollback. These commits preceded the separate issuer and the removal of the legacy workspace. See `6318010`, `90ab7a9`, `465bd58`, `e386a26`, and `ef3e60b`.

## 19 November 2026 · The v1 rewrite

The plan at `719c638` chose one IAM issuer per deployment, a separate console origin, one OAuth client per customer installation, and a live grant check on each protected request. It defined ten phases against fresh data. The architecture records the resulting boundaries. [Architecture](architecture.md)

### Phase 1 · Evaluate Better Auth

Better Auth `1.7.26` passed the evaluation and became the v1 engine. Its OAuth Provider, JWT, and Passkey plugins provided the protocol and credential handlers. IAM supplied invitation rules, per-installation grant enforcement, authorization audit, and key activation. Aligning the fixture's `jose` version to `6.2.17` resolved duplicate `@better-auth/core` instances caused by peer resolution.

The evaluation used PostgreSQL 18.6, Chromium 159, and two provider instances with separate pools in a single process. It passed with the built-in PostgreSQL adapter and with a temporary Drizzle adapter variant using the `pg` driver, enabled transactions, and ORM and Kit `1.0.0-rc.5-5935859`. The Drizzle variant kept the generated tables and removed legacy `relations()` declarations that the pinned RC could not load.

The fixture covered invitation eligibility, password reset, a console session for a user without memberships, two isolated Reports registrations, consent renewal, session-bound passkey elevation, next-request denial, and staged RS256 rollover and rollback. OpenID Foundation suite `release-v5.3.4` reported `FINISHED / PASSED` for these modules.

| Module                                          | Local run ID      |
| ----------------------------------------------- | ----------------- |
| `oidcc-discovery-endpoint-verification`         | `BTP3y43lCmYhApB` |
| `oidcc-ensure-request-with-valid-pkce-succeeds` | `MHUtlz64XOSypUg` |

The evaluation established the engine choice and left the full Basic OP review open. The fixture and decision landed in `97ec243` and `31d9606`. The standalone fixture is available in Git at `3b3b091`.

### Phase 2 · Establish four workspaces and database ownership

The rewrite retired the legacy workspace and put independent Nuxt and Nitro apps under `apps/idp` and `apps/console`. Each API gained its own schema, migration journal, and migration and runtime roles. Both APIs began validating required origins and database access at startup.

All four workspaces built. Both migration sets ran twice against PostgreSQL 18.6 and kept one journal entry each at that stage. Runtime roles performed ordinary data operations in their own schemas. PostgreSQL denied cross-schema access, journal access, and runtime migration attempts. Built APIs rejected malformed origins and missing or incorrect database credentials. See `095f0ce`, `229fbfb`, and `9bc5b78`.

### Phase 3 · Add invitation signup and password recovery

Hosted IdP pages added sign-in, invitation signup, email verification, and recovery. Signup required an eligible invitation for the email address. A matching verified account could accept an invitation, and membership and acceptance committed together. Verification and recovery used generic responses. Password reset invalidated prior IAM sessions.

Chromium on built services verified delivered email, new and existing account acceptance, and recovery. The opt-in API suite verified expiry, wrong-address acceptance, concurrency, replay, and revocation of two sessions against the product Drizzle adapter with Postgres.js. See `bdd1e6d`, `4fd1e6d`, and `8d62c03`. [Invitation fixture](validation.md#invitation-signup-and-recovery)

### Phase 4 · Issue authorization codes for installation grants

The IdP added discovery, confidential Authorization Code with S256 PKCE, installation grants, hosted consent, and a shared signing-key store. The reference Reports server signed in through the issuer and validated RS256 ID tokens. The reserved console client authorized verified users without memberships.

Browser and protocol checks covered initial consent, reuse of current consent with SSO, renewed consent after role changes, stale displayed roles, consent denial, installation isolation, and audit outcomes. Concurrent JWKS requests agreed on the stored key. The issuer rejected unregistered callbacks, missing PKCE, invalid or replayed codes, and exchange after grant revocation. See `e28c664` through `dad2998`. [OIDC fixture](validation.md#oidc-issuer-and-app-grants)

### Phase 5 · Enforce live access and IAM sign-out

The IdP bound introspection to the requesting installation, the current grant, and the SSO session. Reports checked live permissions before each protected request and returned 503 if introspection failed.

Two built IdP processes shared one HTTPS issuer and database. Reports denied the next request after a role change, grant revocation, or IAM sign-out on the other process. The tests also checked unrelated installation access, wrong-client introspection, missing `reports.read`, and access to another user's resource. See `e120900` through `e7f42ad`. [Cross-process fixture](validation.md#live-access-across-idp-processes)

### Phase 6 · Establish the console session

The console became a confidential OIDC client with its own PostgreSQL session and host-only Secure, HttpOnly cookie. A verified account with zero memberships could return to its original protected URL and view its profile. The callback verified the signed ID token and matched UserInfo to the token subject.

Chromium checked invalid and replayed callbacks, unsafe return targets, expiry, local sign-out, and IAM sign-out. Local sign-out still allowed Reports to reuse SSO. Confirmed IAM sign-out ended live Reports access and forced a new sign-in. The console initially discarded the tokens after reading the profile. Phase 7 retained the encrypted access token for live management authorization. See `f96ef05` through `d698e43`. [Console fixture](validation.md#console-session)

### Phase 7 · Add tenant administration and owner recovery

Allowlisted operators gained hosted first-owner provisioning and audited replacement-owner recovery. Owners gained console workflows for invitations, membership, app registrations, roles, and assignments. The IdP rechecked live access, tenant scope, role, and recent passkey verification on management requests.

A Chromium virtual authenticator verified enrollment, step-up, app setup, cross-tenant denial, and recovery through delivered mail. The tests rejected missing, expired, and cross-session step-up, including a challenge issued to another session of the same user. A repeated recovery case was denied. The invitation, OIDC, and live-access regressions passed. The console fixture passed on an independent rerun after a concurrent timeout. See `7366493` through `7a83c23`. [Administration fixtures](validation.md#administration-and-owner-recovery)

### Phase 8 · Restrict audit access and expire events

The IdP recorded authorization approval at code issuance, including SSO reuse, and recorded denials with the resolved installation and organization. Audit events became append-only for the IdP runtime. Dedicated PostgreSQL roles could read audit records or run the bounded purge. The 90-day retention policy preserved duplicate-case rejection through a digest after the original recovery event expired.

Browser, SQL, and log checks verified authorization and recovery evidence, role boundaries, expiry of old rows, and continued duplicate-case denial. Production web builds returned generic fatal responses and logged status under forced render failures. Synthetic credentials were absent from the fixture ingress and upstream logs. See `b259c76` through `d57fb1e`. [Audit checks](validation.md#audit-access-and-retention)

### Phase 9 · Automate signing-key rotation

The issuer began checking the shared keyring once per minute, staging a key after 90 days, activating it after an hour of publication, and retaining retired public keys for 30 days. PostgreSQL serialized transitions. The on-call runbook added retry monitoring, rollback, and emergency handling.

Two built processes logged a failed tick while the key table was unavailable and resumed after access returned. The fixture advanced timestamps to exercise the deadlines. Both processes published the same keys, old tokens remained verifiable during overlap, and rollback restored the original signer. See `19598fd` and `71b3eb2`. [Signing-key operations](signing-key-rotation.md)

### Phase 10 · Rehearse the packaged pilot locally

The repository added Docker packaging, a shared Caddy ingress for two IdP replicas, and a reserved console bootstrap command gated by a verified operator session with fresh passkey step-up. See `179d945` and `cf0adbe`. The results were recorded in `2c9989a`.

The first round ran application fixtures from `71b3eb2` using Node 26.13.0, PostgreSQL 18.6, Mailpit, and Playwright Chromium. Workspace formatting, lint, type checks, and all four builds passed. The default suite skipped nine opt-in integration tests. Separate runs passed all nine and the audit SQL assertions. Each phase used a fresh database. The two-process and browser runs behind standalone test ingress preceded the packaged checks below.

| Packaged rehearsal detail | Recorded value                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Infrastructure            | Caddy 2.11.9, PostgreSQL 18.7, two IdP API replicas, and Mailpit with STARTTLS                         |
| Issuer                    | `https://idp.127.0.0.1.sslip.io:56943`                                                                 |
| Console                   | `https://console.localhost:56943`                                                                      |
| Reference Reports app     | `https://reports.localhost:56982`                                                                      |
| Images                    | IdP API `0924b9ccd0e2`, IdP web `9c621b8faf8a`, console API `98d4993dcbe4`, console web `8700436a760c` |
| Migrations                | Seven IdP and three console migrations applied under separate owners                                   |

Kiri denied host port 443. The local Compose override used loopback port 56943. The browser runs reused the console, live-access, and administration tests with temporary adapters for Compose and Reports. The application fixtures routed explicitly across replicas. The packaged rehearsal used Caddy round-robin routing.

- The console bootstrap rejected an unlisted user and an operator without fresh step-up. A stepped-up fixture session issued one secret and a duplicate registration failed. The administration browser fixture exercised the passkey ceremony.
- A verified user without memberships established a console session. After local sign-out, Reports reused SSO, obtained consent, and served a protected report. Tenant and grant changes were reflected in live access. IAM sign-out invalidated access tied to the SSO session.
- Stopping ingress interrupted introspection and produced 503 from Reports. Access returned after ingress restarted. Taking one replica down produced one discovery 503 during cutover. Discovery succeeded on retry, and the remaining replica served JWKS, sign-in, and sign-out. The other replica separately served discovery, JWKS, and session reads.
- The replacement owner accepted an emailed invitation and enrolled a passkey. The audit reader found one recovery entry, a duplicate case was denied, and the collected Compose logs omitted the synthetic credential marker.
- Both replicas published the original key `01a1f34d-e499-7773-9b98-60c1f6b1d449` and staged key `01a1f34f-2075-70b7-9ce0-32fa5e728898` before activation. RS256 signatures verified before rollover, after rollover, and after rollback.
- The custom-format backup restored in one transaction. Both journal counts, key IDs, five users, four grants, 22 authorization events, and one recovery event matched. Role boundaries held after restore. A fresh signature verified using the restored signer and original Better Auth secret.

The evidence covers a local rehearsal. Production issuer selection and the packaged issuer's remaining Basic OP review stayed open. [Pilot release checks](pilot.md#decide-whether-to-open-the-pilot)

## 19 November 2026 · Portless development

- `60f7350` added the Portless skill. `7bd2af0` added the pinned workspace dependency and the `docker:portless` launcher. The launcher reads the active proxy's HTTPS origins for `idp.iam.localhost` and `console.iam.localhost` and gives both APIs the same issuer. Each public hostname gets a loopback-mapped HTTP ingress. Caddy reuses the same routes and keeps a separate TLS listener inside Docker for calls to the canonical issuer.
- `f56c1b3` added an optional PostgreSQL 18 and Mailpit overlay, database health ordering, persistent volumes, and a STARTTLS mailbox. The overlay binds the database and inbox UI to loopback for local migrations and email inspection.
- `ffc3014` documented the host Portless CA, internal ingress certificate, optional infrastructure, and console registration with the exact callback origin. The packaged pilot evidence above predates the Portless changes. [Portless setup](local.md#docker-with-portless)

## Documentation rewrite

The root and workspace READMEs now describe the implemented IAM flows. The documentation index points to the current local, integration, validation, and operations guides. This file supersedes the completed phase plans and preserves their recorded decisions, verification, and deployment evidence. The original plans and standalone fixture record remain in Git at `ffc3014`.

The documentation pass checked the existing Portless stack on port 1355. Issuer discovery advertised `https://idp.iam.localhost:1355`, and the console account page and Mailpit inbox returned HTTP 200. The default test suite passed with its nine opt-in integration tests skipped.
