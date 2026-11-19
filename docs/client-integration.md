# Connect a server-backed app to IAM v1

## Register the installation

Ask the organization owner to register the installation in the console with its exact HTTPS callback URI. Give each installation its own client ID and secret. Store the secret on the application server. Record the issuer origin and the organization that owns the installation alongside the client ID.

Define the permissions the application checks. Assign a role with those permissions to a verified organization member. The reference app requires `reports.read`. [Organization administration](local.md#onboard-an-organization)

## Sign in

1. Configure an OIDC client library with the pinned issuer, client ID, `client_secret_basic`, and RS256 ID token verification. Load discovery over HTTPS and require an exact issuer match.
2. For each sign-in, generate a verifier, state, and nonce. Bind them to one short-lived browser login and keep the verifier on the server.
3. Redirect to the discovered authorization endpoint with the registered redirect URI, `response_type=code`, `scope=openid`, the state and nonce, and the S256 challenge. The issuer handles sign-in and consent.
4. Consume the login once on callback. Validate state, redeem the code with the same redirect URI and verifier, and authenticate the client. Validate the ID token signature using the issuer's JWKS. Require the configured issuer, client audience, expiry, and original nonce.
5. Start a fresh application session bound to the validated subject and installation. Store the access token server-side. Send the browser an opaque session handle in a Secure, HttpOnly cookie. Keep tokens, authorization codes, and credentials out of logs.

Refresh JWKS within ten minutes and handle an unfamiliar key ID by refreshing through the library. Confirm the cache interval before onboarding. [Key publication and retention](signing-key-rotation.md)

## Authorize each protected request

Use the installation's credentials to send the session's access token to the discovered introspection endpoint. Require `active: true`, the installation's `client_id`, and the session's `sub`. Check the returned permissions and the requested resource's tenant and ownership before returning data. Partition app data by installation even when a user belongs to several organizations.

Reject an inactive token or a subject or client mismatch. Deny a missing permission. If introspection times out, fails, or returns unusable data, withhold the resource. The reference app returns 503 when IAM is unavailable. Every protected request requires a fresh decision, including requests from a previously authorized session.

Local sign-out destroys the application session. To also end the current IAM session, direct the browser to the issuer's `/sign-out` confirmation page. Confirm that the next protected request in another app denies access after IAM sign-out.

The runnable reference server demonstrates discovery, PKCE, callback validation, and a live permission check. Its in-memory session store lasts for one process. [Reference implementation](../examples/reference-app/server.ts) · [Run the reference app](local.md#sign-in-through-the-reference-app)
