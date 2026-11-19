# HTTP API reference

[Documentation index](README.md)

The Nitro service provides the HTTP API and the OIDC issuer. The API shares
the web origin. IDP serves auth pages from its own origin. See the [local setup](local.md)
and [deployment guide](deployment.md).
The [auth package](auth-package.md) defines the credential and
session policies.

## Configuration

Locally, the API listens on port 3000 and the public IAM origin is
`http://localhost:5173`. Set the auth and database variables in the process
environment for staging and production. Local setup uses the workspace dotenv
files. [Local setup](local.md#local-setup)

| Setting                   | Purpose                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                 | Selects the environment. The container defaults to `production`.                                                           |
| `AUTH_SECRET`             | Better Auth secret. Share the same value across API replicas.                                                              |
| `AUTH_URL`                | Public issuer origin. Use an HTTPS origin in production.                                                                   |
| `AUTH_WEB_ORIGIN`         | Browser origin. It must match `AUTH_URL`.                                                                                  |
| `AUTH_IDP_ORIGIN`         | Public IDP origin for hosted auth pages and credentialed browser requests.                                                 |
| `AUTH_SMTP_URL`           | Relay URL. Use `smtps://` for implicit TLS or `smtp://` for required STARTTLS. Encode relay credentials as URL components. |
| `AUTH_SMTP_FROM`          | Sender email authorized by the relay. Set it together with `AUTH_SMTP_URL`.                                                |
| `IAM_API_TRUSTED_PROXIES` | Comma-separated ingress peer IPs. With no trusted peers, the server uses the directly connected peer's IP.                 |
| `DB_*`                    | PostgreSQL connection settings. [Database configuration](database.md#configuration)                                        |

Use origins without paths or trailing slashes. Outside loopback, staging and
production require HTTPS. Keep relay credentials in the API's secret store.
Configure trusted proxies to replace incoming forwarding headers.
[Ingress and TLS](deployment.md#tls-at-ingress)

The [lifecycle plugin](../apps/api/server/plugins/lifecycle.ts) initializes auth at startup.
The shared PostgreSQL pool opens connections on demand and closes at shutdown.

## Authentication routes

The [auth handler](../apps/api/server/api/auth/%5B...all%5D.ts) exposes an explicit
method and path allowlist under `/api/auth`. Use the hosted OIDC flow for
registered applications. [OIDC integration](integrate-app.md#registered-application-sign-in)

| Method and path                            | Response or effect                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POST /api/signup`                         | Accepts a name and email and returns an empty success response for both new and existing addresses.      |
| `POST /api/signin`                         | Sets the Better Auth cookie for a verified account with valid credentials.                               |
| `POST /api/signout`                        | Revokes the signed-in user's session and clears its cookie.                                              |
| `POST /api/auth/sign-up/email`             | Accepts a name, email, and password. Returns `200` with `{}` and no session cookie on accepted requests. |
| `POST /api/auth/sign-in/email`             | Sets the session cookie and returns the public user and redirect fields.                                 |
| `GET /api/auth/get-session`                | Returns the current user or `null`. An authenticated response can renew the cookie.                      |
| `POST /api/auth/sign-out`                  | Revokes the current session and clears its cookie.                                                       |
| `POST /api/auth/account/password-recovery` | Accepts a code request or sets a password after code verification.                                       |
| `GET /api/auth/machine/installation`       | Returns installation metadata for a valid, scoped machine key.                                           |
| `GET /.well-known/openid-configuration`    | Returns the canonical issuer and its protocol endpoints.                                                 |
| `GET /api/auth/ok`                         | Checks whether the Better Auth handler responds.                                                         |

Unknown emails, incorrect passwords, and unverified accounts get the same
public credential denial. Requests for email codes receive a generic
acknowledgment. Eligible accounts can receive one code per five minutes.
The endpoint allows ten requests per client IP per five minutes. Code
redemption sets the password, verifies the email, and revokes existing
sessions. Administrator passkey enrollment allows five password checks per
account per minute.

When upgrading from a release that allowed unverified accounts to sign in,
drain the older replicas before applying the migration that revokes those
sessions. Users with unverified accounts can set a password through the
[email code flow](account.md#email-verification).

## Request authorization

| Requests                                  | Controls                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| All API routes                            | The middleware sets `Cache-Control: no-store` and validates the origin when supplied. It handles credentialed CORS for trusted origins. |
| Ordinary protected API routes             | A valid user session is required. Writes require an `Origin` header. Apply resource-level checks in the handler.                        |
| Hosted account and OIDC actions           | The route checks the issuer origin for browser writes. Each handler enforces its own session or protocol requirements.                  |
| OIDC token, introspection, and revocation | The route accepts form-encoded server requests and strips browser cookies.                                                              |
| Machine installation lookup               | The route accepts the designated machine key and verifies its current installation binding.                                             |

The middleware exception matches `/api/auth` and its child paths, plus
explicit hosted endpoints. A path such as `/api/authentication` requires a
session. Browser preflights may request `Content-Type` and `Authorization`.
[Middleware implementation](../apps/api/server/middleware/auth.ts)

### Authentication responses

| Status | Code               | Meaning                                                                         |
| ------ | ------------------ | ------------------------------------------------------------------------------- |
| `401`  | `UNAUTHORIZED`     | The protected route has no valid session.                                       |
| `403`  | `FORBIDDEN_ORIGIN` | The request has an untrusted origin, or an authenticated write lacks an origin. |
| `503`  | `AUTH_UNAVAILABLE` | The session lookup failed.                                                      |

Better Auth can return endpoint-specific validation, credential, and
rate-limit errors.

## Authentication audit events

### Email sign-in audit

The API writes a JSON `AUTH_EMAIL_SIGN_IN` event to standard output for each
email sign-in processed by Better Auth, including hosted OIDC login.
The event contains a UTC timestamp, request ID, HTTP status, and outcome.
Outcomes are `succeeded`, `denied`, `throttled`, and `error`.
The API attaches the request ID to the response it returns from the audit handler
in `X-Request-ID`. A successful sign-in can include the authenticated user ID.
The audit event excludes emails, IP addresses, passwords, cookies, and tokens.

### Password recovery audit

`AUTH_PASSWORD_RECOVERY` uses the same timestamp, request ID, status, and
outcome fields. Account email code requests produce `accepted` for both
known and unknown addresses. A completed password reset produces `succeeded`.
The audit event has a null `userId`. The separate
`AUTH_PASSWORD_RECOVERY_COMPLETED` event records the account ID after a reset.

### Monitor authentication outcomes

Collect events from every API replica and restrict access to incident
responders. Count events by name and outcome in five-minute windows.
Alert on sustained increases in `denied` and `throttled`. Track `error`
separately for service failures. Keep request and user IDs in restricted
event records. Verify collector delivery and alert routing in staging with
controlled test events.

## OIDC and hosted interactions

Clients discover the current protocol URLs at
`GET /.well-known/openid-configuration`. Discovery returns `503` when
the request origin differs from the configured issuer. The discovery JSON
uses standard OIDC field names and advertises the two supported confidential
client authentication methods.

| Method and path                                                   | Transport and behavior                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/jwks`                                              | Publishes the public signing keys.                                                                                           |
| `GET /api/auth/oauth2/authorize`                                  | Browser authorization request with OAuth query parameters.                                                                   |
| `POST /api/auth/oauth2/authorize`                                 | Form-encoded authorization request.                                                                                          |
| `GET /oidc/login`, `GET /oidc/consent`                            | IDP renders these pages after validating the request through the API.                                                        |
| `GET /api/oidc/client?request=...`                                | Returns `name` and `callbackOrigin` for a validated hosted request.                                                          |
| `POST /api/oidc/login`                                            | Form fields `oauth_query`, `email`, and `password`. Returns a redirect on success.                                           |
| `POST /api/oidc/consent`                                          | Form fields `oauth_query` and `intent`, with `allow` or `deny`. Uses the IAM cookie.                                         |
| `POST /api/auth/oauth2/consent`                                   | Provider endpoint for consent continuation.                                                                                  |
| `POST /api/auth/oauth2/public-client-prelogin`                    | Provider endpoint used for signed prelogin client lookup. Registration remains administrator-controlled.                     |
| `POST /api/auth/oauth2/token`                                     | Form-encoded, client-authenticated code exchange.                                                                            |
| `POST /api/auth/oauth2/introspect`                                | Form-encoded, client-authenticated token status. Returns `{ active: false }` when the live grant fails.                      |
| `POST /api/auth/oauth2/revoke`                                    | Form-encoded, client-authenticated token revocation.                                                                         |
| `GET /api/auth/oauth2/userinfo`, `POST /api/auth/oauth2/userinfo` | Bearer token, with form encoding for POST requests that declare a content type. Returns `{ sub }` for a valid current grant. |

An active introspection response contains `active`, `client_id`, `sub`,
`iss`, `exp`, `scope`, `token_type`, and `permissions`. The issuer uses
`client_secret_basic` or `client_secret_post` as configured for each client.
The token, introspection, and revocation routes reject requests with
`Origin` and discard browser cookies. UserInfo discards browser cookies
and uses the access token. Authorize requests discard an incoming
`Authorization` header.

The provider permits the current grant through the browser and hosted forms.
Nitro converts an accepted provider redirect into an HTTP `303` response.
Hosted interaction responses use `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`.

[OIDC flow](application-access.md#browser-authorization) ·
[Client integration](integrate-app.md)

## Request limits

| Input                                           | Limit or failure                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unknown method and path under `/api/auth`       | `404`.                                                                                              |
| POST body through the auth gateway              | 32,768 bytes by default. Password recovery, organization invitations, and UserInfo use 4,096 bytes. |
| Hosted auth and OIDC form body                  | 32,768 bytes.                                                                                       |
| Authorize query string                          | 8,192 characters. Longer queries receive `414`.                                                     |
| Hosted OIDC signed request parameter            | 8,192 characters.                                                                                   |
| Wrong encoding for an encoding-restricted route | `415`.                                                                                              |
| Rate quota exceeded                             | `429` where supported by the endpoint. Machine-key quota details are in the integration guide.      |

See [account and management contracts](management-api.md) for the
administrator routes and their inputs. The complete auth gateway allowlist
is in the [auth handler](../apps/api/server/api/auth/%5B...all%5D.ts).

## Machine installation lookup

Send `X-API-Key` to `GET /api/auth/machine/installation`. The response is
`{ principalId, installationId, applicationId, status: "active" }`. IAM
resolves the installation from the key. The request has no user, organization,
or installation selector. The key must be current, scoped, and unexpired.

[Machine key setup and quotas](integrate-app.md#machine-access)
