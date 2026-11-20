# Connect a server-backed app to IAM

## Register the installation

Have an authorized organization administrator register the app in the console with its exact HTTPS callback URI. Record the issuer origin and owning organization alongside the installation’s client ID. Keep the issued client secret on the application server.

Define an installation role with the permissions your backend expects. Assign the role to a verified organization member. The reference app requires `reports.read`. [Organization administration](local.md#onboard-an-organization)

## Sign in

1. Configure an OIDC client library with the pinned issuer, client ID, `client_secret_basic`, and RS256 ID token verification. Load discovery over HTTPS and require an exact issuer match.
2. For each sign-in, generate a verifier, state, and nonce. Bind them to one short-lived browser login and keep the verifier on the server.
3. Redirect to the discovered authorization endpoint with the registered redirect URI, `response_type=code`, `scope=openid`, the state and nonce, and the S256 challenge. The issuer handles sign-in and consent.
4. Consume the login once on callback. Validate state, redeem the code with the same redirect URI and verifier, and authenticate the client. Validate the ID token signature using the issuer's JWKS. Require the configured issuer, client audience, expiry, and original nonce.
5. Start a fresh application session bound to the validated subject and installation. Store the access token server-side. Send the browser an opaque session handle in a Secure, HttpOnly cookie. Keep tokens, authorization codes, and credentials out of logs.

Refresh JWKS within ten minutes and handle an unfamiliar key ID by refreshing through the library. Confirm the cache interval before onboarding. [Key publication and retention](signing-key-rotation.md)

## Authorize each protected request

On each protected request, authenticate to the discovered introspection endpoint with the installation’s credentials and submit the session’s access token. Require `active: true`, the installation's `client_id`, and the session's `sub`. Check the returned permissions and the requested resource's tenant and ownership before returning data. Partition app data by installation even when a user belongs to several organizations.

Reject an inactive token or a subject or client mismatch. Deny a missing permission. If introspection times out, fails, or returns unusable data, withhold the resource. The reference app returns 503 when IAM is unavailable. Discard the decision after serving the request.

Local sign-out destroys the application session. To also end the current IAM session, direct the browser to the issuer's `/sign-out` confirmation page. Confirm that the next protected request in another app denies access after IAM sign-out.

The runnable reference server demonstrates discovery, PKCE, callback validation, and a live permission check. Its in-memory session store lasts for one process. [Reference implementation](../examples/reference-app/server.ts) · [Run the reference app](local.md#sign-in-through-the-reference-app)

## Monitor introspection availability

Run the [introspection check](../deploy/sh.check-introspection.sh) from the application's network with curl and jq installed. Use the HTTPS introspection endpoint from the pinned issuer's discovery document. Give the monitor a dedicated confidential installation with no user grants. Store its credentials in a mode-0600 netrc file with a machine entry for the issuer hostname, the client ID as the login and the secret as the password.

```sh
sh deploy/sh.check-introspection.sh "$INTROSPECTION_ENDPOINT" /etc/iam/introspection.netrc
```

The check submits an inactive token and expects HTTP 200 with `active: false`. Exit 2 signals an unreachable endpoint, rejected credentials or an unexpected reply. Exit 3 indicates a local setup error. Configure the monitoring agent to page the identity on-call on repeated failures and clear the alert on exit 0. During commissioning, interrupt the test issuer's introspection route, restore it, and confirm receipt of both notifications. This probe covers authenticated endpoint availability. Use the live-access integration test to verify authorization for an active session.
