# Integrate an application

[Documentation index](README.md)

## Registered application sign-in

Discover the issuer at `/.well-known/openid-configuration` on the IAM web origin.
Register a confidential web client, its exact HTTPS callback URI, and the
organization members who can use it. Configure the app's server-side OIDC SDK for
Authorization Code with S256 PKCE, state, nonce, and the `openid` scope. Store the
client secret server-side. In the callback, use the SDK to validate the response,
exchange the code, and validate the ID token. Link the user by issuer and subject
and establish a session on the app's own origin.

Use `prompt=none` when the app needs a silent authorization check. A current
IAM session and consent for the current app grant allow the browser to return
directly with a code. Handle `login_required` or `consent_required` by starting
an interactive authorization request if the user wants to continue. Use
`prompt=login` when the app requires fresh authentication, and check the ID
token's `auth_time` when applying a session-age policy.
[OpenID Connect authentication requests](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)

Set both `AUTH_URL` and `AUTH_WEB_ORIGIN` to the public issuer. Preserve
the public host and scheme at the trusted reverse proxy. Keep the token exchange on the app server.

## Run the reference client

The [reference client](../apps/web/examples/oidc-client.ts) runs a separate Node HTTPS
server and uses `openid-client` for discovery, sign-in, introspection, and
revocation. To try it with local IAM, run IAM at `http://localhost:5173` and
register a private app with the callback `https://reports.localhost:8443/callback`.
Use a DNS hostname in the callback. The `reports.localhost` hostname resolves
to loopback and gives each service its own cookie host.

In the app's access settings, add the `reports.read` permission, include it in
a role, and assign that role to the member who will sign in. Supply the
registration's client ID and secret as `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`
in the server environment. The certificate and key below must belong to a
certificate trusted by your browser with `reports.localhost` as a DNS subject
alternative name.

Run this from the repository root with the workspace dependencies installed.

```sh
OIDC_ISSUER="http://localhost:5173" \
REFERENCE_ORIGIN="https://reports.localhost:8443" \
REFERENCE_TLS_CERT="/path/to/reference.crt" \
REFERENCE_TLS_KEY="/path/to/reference.key" \
vpx apps/web/examples/oidc-client.ts
```

Open `https://reports.localhost:8443` and choose **Sign in with IAM**. After the browser
returns, **Read reports** checks the current permission against IAM. Remove `reports.read` from the role and check that the next request returns
`403`. Revoke the app assignment and check for `401`. **Sign out** ends the app session and revokes its
access token. The IAM browser session can be used for another sign-in.

The client defaults to HTTP Basic. For an app registered with POST body
authentication, set `OIDC_CLIENT_AUTH_METHOD="client_secret_post"` before
starting the example.

The example listens on loopback and keeps its short-lived sessions in
process memory. Restarting it clears those sessions. The browser gets an
opaque session cookie, and the server holds the tokens.

## Protected requests and logout

Keep the access token on the application backend. Use the SDK's token
introspection method for each protected operation. IAM authenticates the client
with its confidential credential. An active response includes the issuer,
subject, issuing client, expiry, and current `permissions` for that app. Match
issuer, client and subject to the local session. Require the relevant permission
and check object ownership in the application. Deny the request on inactive
tokens, missing permissions, or an IAM error. Treat the ID token as proof of
sign-in at the callback.

For OIDC UserInfo, call `/api/auth/oauth2/userinfo` on the issuer with the
same access token. IAM supports GET and POST and returns only `sub`, which
must match the ID token subject. The token must still have a live session and
app grant. Use introspection when the app needs its current permissions.
[OpenID Connect UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo)

The app can revoke its access token through the SDK's token revocation method
when ending its local session. Signing out of IAM invalidates introspection for
tokens tied to that IAM session. An organization can revoke its member's app
assignment. Granting access again requires a new authorization and consent.

Client disablement and emergency credential rotation are server management
operations. Both invalidate issued access tokens and outstanding codes and write an audit event.
Rotation replaces the secret immediately. Move the replacement to the app's
secret store and start new sign-ins. Audit records contain actor, installation,
action, and identifiers. Restrict reads and exclude credentials, tokens, and
authorization codes from application and proxy logs.

## Machine access

An application backend can check its installation with
`GET /api/auth/machine/installation` on the IAM web origin. Send its machine key
in the `X-API-Key` header. The response identifies the active installation,
application, and machine principal bound to that key. The request has no tenant
or user selector. IAM checks organization ownership, key expiry, and
installation status on each call.

A verified organization owner can issue, rotate, or revoke the key through the
server management service after recent MFA. Each installation has one active
machine key. The key expires after seven days. Rotation immediately disables
the previous key and returns the replacement once. Keep it in the app server's
secret store. Key management records an audit event with the key identifier.
The endpoint uses database-backed quotas of 60 requests per minute per key and
120 per minute per client IP. Route public requests through the trusted IAM ingress
so Nitro sees the original client IP.

Run the hosted integration test against the built IAM server with a
disposable migrated PostgreSQL database. Set `AUTH_WEB_TEST_URL` to the IAM
origin and `AUTH_TEST_DB_PORT` to its database port. Set `AUTH_OIDC_TEST_URL` to the
same web origin to include the OIDC SDK test. Run `vp test apps/web/tests` for the
web suite. Export the test API's `AUTH_SECRET` to include the administrator
passkey boundary test and to share signing keys across fixtures in a full run. The
local HTTP exception in the SDK test is for loopback fixtures.
