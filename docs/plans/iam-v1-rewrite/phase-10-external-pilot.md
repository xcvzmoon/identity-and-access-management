# Phase 10. Rehearse the external pilot

[Implementation plan](overview.md) · [External pilot gate](../../rewrite-scope.md#external-pilot-gate)

## Changes

- Package the four workspaces with Docker and Compose. Configure ingress
  for the IdP issuer and the separate console origin. Pin the production
  issuer hostname before registering external clients.
- Deploy at least two IdP API replicas behind one issuer. Use the same
  database and signing-key state. Document migrations, backup and
  restore, operator recovery, key rotation, and rollback.
- Publish v1 integration and deployment instructions for the supported
  client profile. Rehearse with the rewrite database and fixtures.

## Verification

Run the workspace, PostgreSQL, browser, and replica checks on the pilot
setup. Complete console and reference-app sign-in, tenant isolation,
next-request revocation, IAM sign-out, owner recovery, and signing-key
rollover and rollback. Exercise a replica outage, an unavailable live
check, and database restore. Record evidence for each case, the actual
issuer used, and the conformance scope. The Phase 1 results cover
discovery and the selected confidential-client PKCE case. Review the
remaining Basic OP conformance coverage before opening the pilot.

## Local rehearsal completed on 19 November 2026

The four workspace images ran behind Caddy 2.11.9. The two IdP API containers used image `0924b9ccd0e2`, one Better Auth secret, and one PostgreSQL 18.7 primary. The IdP web, console API, and console web image IDs were `9c621b8faf8a`, `98d4993dcbe4`, and `8700436a760c`. Source revisions `179d945` and `cf0adbe` contain the packaging and console bootstrap command.

The issuer was `https://idp.127.0.0.1.sslip.io:56943` and the console origin was `https://console.localhost:56943`. The host-side reference backend served `https://reports.localhost:56982` through a test TLS proxy. All three names resolved to loopback on the host. Kiri denied the port 443 binding, so the rehearsal used the local Compose port. The database, accounts, client registrations, mailbox and TLS material were disposable. Production DNS selection remains with the operator before the first external registration.

| Check                            | Observed result                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace and database           | Formatting, linting, type checks and all four production builds passed. The default suite passed its enabled tests. Separate runs passed all nine opt-in tests and the audit SQL assertions. The packaged database applied seven IdP migrations and three console migrations under separate owners.                                                                                                   |
| Operator bootstrap               | On an isolated copy of the migrated database, the CLI rejected an unlisted user and an operator without a fresh step-up. A fixture session with a current verification timestamp produced a single secret. A second registration failed. The browser administration fixture exercised the actual passkey ceremony.                                                                                    |
| Console and reference sign-in    | Chromium established a host-only console session for a verified account with no memberships. Local sign-out ended that session. Reports then obtained consent and served the assigned user's protected report.                                                                                                                                                                                        |
| Tenant isolation and revocation  | The live-access fixture denied a different installation's token and the next protected request after a role or grant change. IAM sign-out invalidated live access for the browser session while its token was still unexpired.                                                                                                                                                                        |
| Live-check outage                | Stopping the ingress interrupted introspection. Reports returned 503. Restarting ingress restored access for a current grant.                                                                                                                                                                                                                                                                         |
| Owner recovery and log redaction | Mailpit accepted the owner invitation over STARTTLS. The replacement accepted and enrolled a passkey. The audit reader found one recovery record and a repeated case was rejected. The synthetic credential marker was absent from the collected Compose logs.                                                                                                                                        |
| Key rollover and rollback        | The rehearsal advanced the disposable key's age and the staged activation deadline. Both API containers published the same two public keys before activation. RS256 signatures verified against public JWKS under the original signer, replacement and rolled-back signer. Original key ID `01a1f34d-e499-7773-9b98-60c1f6b1d449`. Replacement `01a1f34f-2075-70b7-9ce0-32fa5e728898`.                |
| Restore                          | A custom-format dump restored in one transaction to a fresh database. Both journal counts, key IDs, five users, four grants, 22 authorization events and one recovery event matched. The audit reader retained access and each runtime remained isolated from the other schema. A fresh signature verified using the restored signer and the original Better Auth secret.                             |
| Replica loss                     | The APIs reopened against the restored database. After stopping the first replica, one discovery request returned 503 during cutover and succeeded on retry. The remaining replica served discovery, JWKS, fresh console and Reports sign-in, and IAM sign-out. With just the first replica serving in a separate check, discovery, JWKS and session reads all returned 200. Both replicas restarted. |

The packaged browser runs reused the console-session, live-access, and administration fixtures with temporary adapters for Compose lifecycle and the reference backend. The host fixtures exercised explicit cross-replica routing. The packaged fixtures used Caddy round-robin routing. [Application fixture results](../../pilot-fixtures.md) · [Deployment and recovery runbook](../../pilot.md) · [Client integration guide](../../client-integration.md)

Phase 1 recorded two OpenID Foundation module passes on the evaluation fixture. Full Basic OP coverage remains open. The v1 client contract supports static confidential clients with S256 PKCE and Basic client authentication. The runbook records the remaining conformance decision, including the suite's client authentication requirements. [Conformance review](../../pilot.md#decide-whether-to-open-the-pilot)
