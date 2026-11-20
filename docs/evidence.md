# IAM fresh-install evidence

This walkthrough was recorded on 19 November 2026 from a fresh local clone of commit `4945f52`. The run used Docker Compose on the `kiri` context, Portless HTTPS on port 1355, PostgreSQL 18, and Mailpit. The browser used one desktop viewport. Account names, domains, and recovery references are fixtures. Passkey ceremonies used Chromium virtual authenticators. The Mailpit screenshot hides message previews that contain action links.

## 1. Reset and build the stack

The reset removed nine IAM containers, four IAM application images, the `iam_pgdata` and `iam_maildata` volumes, and the generated environment and certificate files. A Docker inventory check found zero containers and zero volumes for project `iam` before the new run. The fresh clone contained the checked-in environment templates.

1. Install the locked dependencies with `vp install --frozen-lockfile`.
2. Copy `.env.portless.example` to `.env.portless` and add `compose.portless-infra.yaml` to `COMPOSE_FILE`. Create both API runtime files from their templates. Generate a PostgreSQL administrator password, a shared IdP secret, the ingress and Mailpit certificates, and the container trust bundle.
3. Start the database and mailbox. Create separate migration and runtime logins and the two audit group roles. Apply seven IdP migrations and three console migrations to the new database using their respective migration logins.
4. Build the four application images with `--no-cache` and start the stack. Wait for discovery to respond after the API containers start or are recreated. During one IdP recreation, ingress briefly returned 503 before health checks recovered. [Local setup](local.md#docker-with-portless) · [Database setup](local.md#database-setup)

```sh
vp run docker:portless up -d --wait database mail
vp -C apps/idp/api run db:migrate
vp -C apps/console/api run db:migrate
vp run docker:portless build --no-cache
vp run docker:portless up -d --wait
vp run docker:portless ps
vp exec portless list
```

| Service                  | Address used in the run              |
| ------------------------ | ------------------------------------ |
| IdP web and OIDC issuer  | `https://idp.iam.localhost:1355`     |
| Console                  | `https://console.iam.localhost:1355` |
| PostgreSQL from the host | `127.0.0.1:56985`                    |
| Mailpit inbox            | `http://127.0.0.1:56986`             |

Discovery returned the configured issuer, supported Authorization Code and S256 PKCE, and advertised the token, introspection, UserInfo, and JWKS endpoints. The hosted sign-in page opened over the same origin.

![OpenID Connect discovery from the fresh IdP](evidence-assets/01-issuer-discovery.png)

![Hosted IAM sign-in](evidence-assets/02-idp-sign-in.png)

## 2. Bootstrap the operator and console

1. Run `vpx apps/idp/api/scripts/ts.provision-operator.ts` for the operator account using the host database address. Add the returned user ID to `OPERATOR_USER_IDS` and recreate both IdP replicas.
2. Use **Resend verification email** on the issuer. Open the delivered verification link in Mailpit. Use **Forgot password** to set the operator's password, then sign in.
3. Enroll a passkey at `/passkeys` and verify it. The success message confirms a five-minute verification window.
4. Supply the verified operator's session cookie to `ts.provision-console.ts` through a private file. Set `CONSOLE_ORIGIN` to the full Portless console origin. Put the returned client secret into `OIDC_CLIENT_SECRET` and recreate the console API.
5. Open the console's `/account` page. The reserved console client reused the operator's IAM session and displayed the account before any organization membership existed. [Console provisioning](pilot.md#provision-the-console-client)

![Operator email verification request](evidence-assets/03-operator-verification-request.png)

![Operator password reset succeeded](evidence-assets/04-operator-password-set.png)

![Operator passkey enrolled](evidence-assets/05-operator-passkey-enrolled.png)

![Operator passkey verified](evidence-assets/06-operator-passkey-verified.png)

![Console account for the operator](evidence-assets/07-console-account-no-membership.png)

## 3. Onboard an organization owner

The operator verified a passkey and used `/operator` to invite the first owner of **Northwind Research**. The owner opened the delivered invitation, created an account for the invited email address, followed the verification message, then returned to accept the invitation after signing in.

The owner opened **Manage organizations** from the console, enrolled a passkey at the IdP, and verified it before changing organization data. [Organization onboarding](local.md#onboard-an-organization)

![First owner invitation sent](evidence-assets/08-first-owner-invited.png)

![Owner invitation and verification email delivered to Mailpit](evidence-assets/09-mailpit-inbox.png)

![Invitation signup requested email verification](evidence-assets/09-owner-signup.png)

![Verified owner accepted the invitation](evidence-assets/09-owner-joined.png)

![Northwind available to its owner in the console](evidence-assets/10-owner-management.png)

![Owner verified a passkey before management changes](evidence-assets/11-owner-passkey-step-up.png)

## 4. Invite a member and grant application access

The owner invited Riley as a member. The console showed the pending invitation. Riley used the signup and verification flow to accept it, and the console then listed Riley as a member.

The owner registered **Research Reports** with the exact callback `https://reports.iam.localhost:1355/callback`. The client secret went to the reference backend and was hidden before capture. The owner defined a `reader` role with `reports.read` and assigned it to Riley. The assignment appeared in the console. [Client registration and permissions](client-integration.md#register-the-installation)

![Pending member invitation](evidence-assets/12-member-invited.png)

![Accepted member listed in the console](evidence-assets/13-member-accepted.png)

![Research Reports registered as a private installation](evidence-assets/14-app-registered.png)

![Reader role with reports.read permission](evidence-assets/15-installation-role.png)

![Reader role assigned to Riley](evidence-assets/16-role-assigned.png)

## 5. Authorize Reports with OIDC

The reference app used its registered callback and client credentials to initiate Authorization Code with S256 PKCE. IAM reused Riley's sign-in and displayed the app, organization, role, requested scopes, and permissions. Riley declined the first request and Reports rejected the callback. On a new request, Riley allowed access. The app completed sign-in and the protected report returned HTTP 200 after a live permissions check. [Sign-in and protected requests](client-integration.md)

![Consent for Northwind Research Reports](evidence-assets/17-reports-consent.png)

![Reports rejected the declined authorization](evidence-assets/18-consent-declined.png)

![Reports established an application session](evidence-assets/19-reports-signed-in.png)

![Protected report returned after live authorization](evidence-assets/20-protected-report.png)

## 6. Verify tenant isolation

The operator onboarded **Southbank Studio**. Avery accepted the invitation with the same verified account and used the organization selector to register the separate **Studio Reports** installation. Riley tried to sign in to Studio Reports with the Northwind IAM session and was denied. The original Northwind report still returned HTTP 200.

![Existing account accepted a second organization invitation](evidence-assets/21-existing-account-joined.png)

![Southbank's separate Reports installation](evidence-assets/22-second-installation.png)

![Northwind member denied by the Southbank installation](evidence-assets/23-other-tenant-denied.png)

## 7. Change access and compare sign-out actions

1. The owner changed the `reader` role to include `reports.export`. The previous report session received HTTP 401. At the next sign-in, IAM presented consent for the updated permissions.
2. The owner revoked Riley's assignment. The next protected request returned HTTP 401.
3. The owner restored the assignment for the sign-out check. Riley signed out of the console and the existing Reports session still returned HTTP 200.
4. Riley returned to the console through SSO and selected **Sign out of IAM**. After the issuer confirmation, the next protected Reports request returned HTTP 401. [Live authorization and sign-out](architecture.md#sign-in-and-authorization)

![Renewed consent after the role changed](evidence-assets/24-renewed-consent.png)

![Revoked grant removed from the assignment list](evidence-assets/25-grant-revoked.png)

![Local console sign-out](evidence-assets/26-console-only-sign-out.png)

![Issuer confirmation for IAM sign-out](evidence-assets/27-iam-sign-out-confirmation.png)

![Issuer confirmed that the IAM session ended](evidence-assets/28-iam-session-ended.png)

## 8. Administer the organization and recover ownership

The owner removed Riley's membership, disabled Research Reports, and renamed the organization to **Northwind Research Lab**. The console refreshed the organization after each operation.

To rehearse owner lockout, the walkthrough removed Avery's virtual authenticator. The operator verified a separate passkey, opened recovery at `/operator`, entered the organization ID and fixture case reference `EVIDENCE-OWNER-001`, and sent the replacement invitation. Reusing the same case returned HTTP 400. Casey followed the invitation and verification links, accepted ownership, and enrolled a new passkey. [Owner recovery procedure](local.md#recover-a-locked-out-organization)

![Member removed from Northwind](evidence-assets/29-member-removed.png)

![Disabled Reports no longer appears in the installation list](evidence-assets/30-installation-disabled.png)

![Northwind Research Lab after the rename](evidence-assets/31-organization-renamed.png)

![Operator recovery form with the fixture case](evidence-assets/32-owner-recovery-form.png)

![Replacement owner invitation sent](evidence-assets/33-replacement-invited.png)

![Replacement account signup requested verification](evidence-assets/34-replacement-signup.png)

![Replacement owner accepted the invitation](evidence-assets/34-replacement-joined.png)

## 9. Reset a password and verify the recovered console

Riley started two separate IAM sessions, then requested a password reset. The reset page accepted the new password. The other session returned `null` from `/api/v1/auth/get-session`, the old password returned HTTP 401, and the new password returned HTTP 200.

Casey opened the recovered organization through console sign-in and appeared as an owner. Casey then invited Riley's existing verified account as an administrator. Riley accepted the invitation and the console displayed the administrator role.

![Password reset completed and the previous sessions were rejected](evidence-assets/35-password-reset-revoked-sessions.png)

![Replacement owner listed in the recovered console](evidence-assets/36-recovered-organization.png)

![Existing account accepted as an administrator](evidence-assets/37-administrator-role.png)

## 10. Verify issuer and database operations

### Replica availability and signing keys

Both IdP replicas returned the same issuer URL and public signing key ID. With the first replica stopped, discovery, JWKS, and session reads each returned HTTP 200 through ingress. The first replica was then restarted.

![Public signing key served at the issuer's JWKS endpoint](evidence-assets/38-issuer-jwks.png)

The signing-key fixture ran on a separate empty keyring. Two concurrent rotation attempts produced one staged replacement. Both public keys appeared in JWKS while the original key still signed tokens. After the staged deadline, the replacement signed new tokens. Both signatures verified during overlap, and rollback restored the original signer. The fixture advanced timestamps to exercise the transitions. [Signing-key operations](signing-key-rotation.md)

### Audit access, retention, and restore

A dedicated audit reader queried the fresh installation. The IdP runtime login was denied read access to the authorization audit table. The following results were captured after replacement-owner acceptance.

```text
stage          outcome   count
authorization  approved      7
authorization  denied        1
consent        denied        1
exchange       approved      7

case_reference      outcome
EVIDENCE-OWNER-001  invited
```

The retention fixture ran in a separate disposable database. It checked the audit roles, removed two expired fixture rows, rejected reuse of an expired recovery case, and rolled back its changes. [Audit roles and retention](local.md#audit-retention)

A custom-format dump restored to a separate database in one transaction. The source and restore matched on these counts.

| Record                | Count in source and restore |
| --------------------- | --------------------------: |
| Users                 |                           4 |
| Organizations         |                           2 |
| Authorization events  |                          16 |
| Owner recovery events |                           1 |
| Signing keys          |                           1 |
| IdP migrations        |                           7 |
| Console migrations    |                           3 |

### Live access and session binding

The cross-process fixture ran against a second disposable database. Reports denied the next protected request after a grant change, revocation, and IAM sign-out. It returned HTTP 503 while introspection was unavailable and recovered after the endpoint returned. The passkey regression fixture also rejected a challenge presented from another session of the same user. [Validation procedures](validation.md)

### Operational logs

The console callback produced the following evlog fields. The IdP's password-reset GET also appeared under the template `/api/v1/auth/reset-password/:token`.

```json
{
  "event": "api-request",
  "service": "iam-console-api",
  "method": "GET",
  "path": "/api/v1/callback",
  "status": 303,
  "durationMs": 48
}
```

Caddy recorded successful management POSTs, while the corresponding API events were missing. H3's body-size check replaces the request object, and the API logger looks up the event using that object. The audit tables contained the recorded authorization and owner-recovery outcomes.

The default suite and the opt-in live-access, signing-key rotation, and passkey-session tests passed. The audit SQL fixture passed separately. Production DNS and full Basic OP conformance remain tracked in the pilot runbook. [Pilot release checks](pilot.md#decide-whether-to-open-the-pilot)

## Enterprise release decision for candidate `4c02ffa`

**Hold enterprise production.** The local candidate passed all ten integration cases using the application bundles extracted from four Linux arm64 images. An isolated Compose deployment used the verified digests for all five application services. The operator supplied no production evidence, approved customer workload, recovery objectives or named acceptance reviewer. [Redacted candidate evidence](evidence-assets/enterprise-candidate.json)

| Plan phase                 | Verified locally                                                                                                                                                                                      | Still open for enterprise release                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release qualification      | Clean candidate, signed image promotion with a disposable key, 18 IdP and three console migration journal entries, upgrade and restore                                                                | Trusted release pipeline and a decision on the supported OIDC profile. Full Basic OP conformance remains open because the ordinary flow omits mandatory PKCE.                                                                                                              |
| Ingress and package policy | Effective framing and privacy headers on issuer and console pages, private API port bindings, four image inventories and scans                                                                        | Production proxy path, peer restrictions, TLS, signing trust and advisory disposition. Each image had 72 High installed-package matches, zero Critical and zero with a listed fix. A separate dependency scan found a Medium minimatch advisory in three workspace graphs. |
| Privileged actions         | Owner recovery, scoped management, passkey verification, restricted audit access, key rollback and client-secret cutoff                                                                               | Approval of the first-passkey policy and recovery process, including who verifies requests and who can act when the primary operator is unavailable.                                                                                                                       |
| Capacity                   | Password sign-in, code exchange, introspection, console login and organization administration measured on local fixtures                                                                              | Approved traffic mix, tenant sizes, thresholds and measurements on the intended topology.                                                                                                                                                                                  |
| Resilience                 | One issuer replica stopped, an alternate ingress served the application, a caught-up PostgreSQL standby accepted writes after manual promotion, and a restored fixture reconciled a session and grant | Deployment failover, backup and secret access, reconciliation of all revocations and retired keys, and acceptance against recovery objectives.                                                                                                                             |
| Operations and acceptance  | Keyboard sign-in, consent and passkey controls in Chromium, recovery-request submission, retention checks and an offboarding procedure                                                                | On-call alert receipts, backup expiry, privacy and support ownership, screen-reader acceptance and an independent customer onboarding and offboarding rehearsal.                                                                                                           |

The image scans and recovery timings apply to this candidate and fixture. The separate evidence archive named in the redacted record contains the signed manifest, release receipt, per-phase results, SBOMs and scanner output.
