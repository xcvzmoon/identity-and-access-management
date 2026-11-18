# Auth package reference

[Documentation index](README.md)

`@iam/auth` configures Better Auth for the Nitro server. It owns credentials,
sessions, email codes, OIDC, administrator passkeys, and machine credentials.
The [identity lifecycle](identity.md) describes how those policies fit together.

## Public API

| Export                          | Purpose                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `useAuth()`                     | Return the process-wide Better Auth instance. The first call validates settings and obtains the shared PostgreSQL client. |
| `registerApplication()`         | Register an organization-owned app and its confidential OAuth client.                                                     |
| `manageApplicationClient()`     | Manage the app's OAuth client settings, secret, and status.                                                               |
| `manageApplicationMachineKey()` | Issue, rotate, or revoke a key for an app installation.                                                                   |

The three provisioning and credential exports accept the database, issuer
configuration, headers with the administrator session, and the operation
input. Calls from a trusted server must check recent administrator
verification before invoking these exports. The underlying services check
organization authority in their transactions. The HTTP administration
endpoint applies the passkey requirement before it invokes the writes.
[Admin action inputs and outputs](management-api.md#administrator-interaction)

When reading a session on the server, request response headers so your handler
can forward any cookie renewal or clearing headers.

```ts
import { useAuth } from '@iam/auth';

export async function readSession(request: Request) {
  return useAuth().api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
}
```

The consuming server routes requests and closes the shared database client
on shutdown. [HTTP routes and authorization](http-api.md#request-authorization)

## Configuration

| Variable                             | Purpose                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `APP_ENV`                            | Selects `local`, `testing`, `staging`, or `production`.                                                                  |
| `AUTH_SECRET`                        | Better Auth secret of at least 32 characters. All replicas use the same value.                                           |
| `AUTH_URL`                           | Public IAM origin. Use `http://localhost:5173` for local development.                                                    |
| `AUTH_WEB_ORIGIN`                    | Browser origin. It must equal `AUTH_URL`.                                                                                |
| `AUTH_SMTP_URL` and `AUTH_SMTP_FROM` | Relay URL and sender for email verification, password recovery, and invitation notices. Supply both values to send mail. |

Origins contain a scheme and host, with a port when needed. Omit paths and
trailing slashes. Staging and production require HTTPS outside loopback.
Local mode reads `packages/auth/.env` and gives process variables precedence.
Testing, staging, and production read settings from the process environment.
[Example environment file](../packages/auth/.env.example) ·
[Database settings](database.md#configuration)

## Credential and session policies

### Email and password

Signup accepts valid submissions with the same public response for new and
existing addresses. Before signing in, the user proves email ownership and
sets a password with an emailed code. Unknown emails, incorrect passwords,
and unverified accounts receive the same public credential denial. Passwords
have 12 to 128 characters. Better Auth stores a scrypt hash on the credential
account. [Auth factory](../packages/auth/src/utils/auth.ts) ·
[Account activation](account.md#email-verification)

Email codes expire after five minutes. IAM stores a keyed hash of each code,
limits retries, and consumes the code on successful use. Setting or resetting
a password through the email flow revokes existing sessions.
[Recovery implementation](../packages/auth/src/utils/password-recovery.ts)

### Persistence and cookies

Better Auth uses the Drizzle Relations v2 adapter with the PostgreSQL `iam`
schema and transactions. Drizzle supplies UUIDv7 IDs. Better Auth stores
sessions in PostgreSQL and identifies them with a signed, HTTP-only,
SameSite Lax cookie. HTTPS uses the Secure cookie and `__Secure-` name prefix.
Session reads can renew the cookie. The pinned provider defaults to a
seven-day lifetime and a one-day refresh interval. IAM validates sessions
against the database. [Schema reference](database.md#authentication-tables)

### Origins, rate limits, and logs

Better Auth enforces origin and CSRF checks. Nitro checks the canonical
issuer origin for hosted writes and resolves client IPs through its trusted
proxy policy. Database-backed counters in `iam.rate_limits` apply across
replicas. Recovery, administrator actions, and machine requests have
endpoint-specific rules. [API origin checks](http-api.md#request-authorization)

The package logger emits `AUTH_WARNING` and `AUTH_ERROR`. The API emits
separate structured audit events for sign-in and recovery.
[Authentication audit events](http-api.md#email-sign-in-audit)

## Validation

Run `vp run build` first on a fresh checkout, then run these commands from
the repository root.

```sh
vp run '@iam/auth#typecheck'
vp run '@iam/auth#test'
```

Use the [integration fixture](validation.md#integration-tests) for tests
that need PostgreSQL.

## Policy modules

| Module                                                                                                                                                                                                                                                            | Responsibility                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`createAuth()`](../packages/auth/src/utils/auth.ts)                                                                                                                                                                                                              | Creates Better Auth with the database adapter and IAM's configured plugins. Registers JWT key creation under a PostgreSQL advisory lock.   |
| [`withAuthAdapter()`](../packages/auth/src/utils/auth-adapter-scope.ts)                                                                                                                                                                                           | Uses the supplied adapter scope for internal auth calls during a management operation.                                                     |
| [`createApplicationOidcProvider()`](../packages/auth/src/utils/oidc.ts)                                                                                                                                                                                           | Configures Authorization Code, the hosted login and consent pages, and grant checks at authorization and exchange.                         |
| [`applicationTokenResponses()`](../packages/auth/src/utils/oidc-token-responses.ts) and [`requireCurrentUserInfoGrant()`](../packages/auth/src/utils/oidc-token-responses.ts)                                                                                     | Recheck live app grants, project UserInfo, and supply current introspection permissions.                                                   |
| [`registerApplication()`](../packages/auth/src/utils/register-application.ts)                                                                                                                                                                                     | Validates the callback and manager, creates the app, installation, and OAuth client, and records an audit event.                           |
| [`manageApplicationClient()`](../packages/auth/src/utils/manage-application-client.ts)                                                                                                                                                                            | Locks the credential target, checks management authority and expected version, and applies disablement, rotation, or callback replacement. |
| [`manageApplicationMachineKey()`](../packages/auth/src/utils/manage-application-machine-key.ts)                                                                                                                                                                   | Checks the installation owner and applies scoped key issuance, rotation, or revocation.                                                    |
| [`readApplicationCredentialOverview()`](../packages/auth/src/utils/application-credential-overview.ts) and [`readCurrentMachineKey()`](../packages/auth/src/utils/current-machine-key.ts)                                                                         | Read credential metadata for management views.                                                                                             |
| [`adminAccess()`](../packages/auth/src/utils/admin-access.ts) and [`adminInteraction()`](../packages/auth/src/utils/admin-interaction.ts)                                                                                                                         | Expose collection reads, WebAuthn ceremonies, and administrator writes with role and session checks.                                       |
| [`organizationInvitations()`](../packages/auth/src/utils/organization-invitations.ts), [`organizationMembership()`](../packages/auth/src/utils/organization-membership.ts), and [`organizationOwnership()`](../packages/auth/src/utils/organization-ownership.ts) | Apply scoped invitation, suspension, role, and ownership rules.                                                                            |
| [`passwordRecovery()`](../packages/auth/src/utils/password-recovery.ts), [`accountCodes()`](../packages/auth/src/utils/account-otp.ts), and [`reservePasswordRecoveryEmail()`](../packages/auth/src/utils/account-email-rate.ts)                                  | Control code eligibility, privacy, retries, delivery cooldown, and session revocation.                                                     |

The public package exports are listed above. The other functions in this
table are implementation entry points inside the package.
