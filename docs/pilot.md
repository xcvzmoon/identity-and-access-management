# Validate and contain a pilot

[Documentation index](README.md)

## Pilot replica check

Run this check against local builds and the disposable database described in
the [integration test setup](validation.md#integration-tests). Set
`APP_ENV="testing"` and give both Nitro processes the same database variables,
`AUTH_SECRET`, and canonical issuer `http://127.0.0.1:5173` for both
`AUTH_URL` and `AUTH_WEB_ORIGIN`. Run the replicas on different ports.
Configure a local ingress on port 5175 to return HTTP 503 for the outage check.

```sh
HOST="127.0.0.1" PORT="5173" node apps/api/.output/server/index.mjs
HOST="127.0.0.1" PORT="5174" node apps/api/.output/server/index.mjs
```

Export the shared test `AUTH_SECRET` before running the replica test. Run it
by itself against a fresh fixture so other HTTP tests on loopback do not
consume the same database-backed rate limits.

```sh
AUTH_TEST_DB_PORT="55439" \
AUTH_OIDC_TEST_URL="http://127.0.0.1:5173" \
AUTH_OIDC_REPLICA_TEST_URL="http://127.0.0.1:5174" \
AUTH_OIDC_UNAVAILABLE_TEST_URL="http://127.0.0.1:5175" \
vp test apps/web/tests/oidc.integration.test.ts -t "contain pilot rollback"
```

The test first requests JWKS from both replicas concurrently. The fresh
database must store one signing key, and both responses must publish it.
The test then uses the first replica for discovery and browser redirects
and directs SDK back-channel requests to the other processes while retaining
the canonical issuer. It checks code exchange on the second replica, permission
changes and secret rotation on both replicas, and HTTP 503 when the upstream
is unavailable. The outage case uses a token already verified as active. The
same test rehearses rollback and checks that both replicas reject a token
that was active immediately before disablement. It verifies the audit events
and obtains a new code for a separate control app.

Before enabling a pilot organization, repeat the browser flow through staging's
TLS ingress with two organizations and private app assignments. The hosted
OIDC suite uses one account in both organizations to verify that membership
alone cannot open a private app. It checks each app's permissions and confirms
that revoking one assignment leaves the other app usable. Verify that live
permission changes and credential rotation take effect across replicas.
Keep the old credential out of logs and update the app's secret store with the
replacement.

## Stop a pilot app

1. Open `/admin`, verify your passkey, and confirm the owning organization,
   installation ID, and OAuth client ID.
2. In **Credential management**, choose **Disable client**. Revoke the
   pilot's app assignments. If it has a machine key, have an organization
   owner revoke that key too.
3. Check token introspection and UserInfo on every replica with a previously
   active pilot token. Confirm that neither endpoint grants access and that
   a fresh authorization attempt issues no code. Confirm that a separate
   control app can still sign in.
4. Confirm the `client.disabled` and `assignment.revoked` audit events name
   the intended actor and installation. Retain the schema and audit records.

## Verify OpenID discovery and signing

New ID tokens use RS256. On an existing deployment, stop the API processes
before applying the signing-key migration, then start the updated build with
the same `AUTH_SECRET`. The migration retires EdDSA keys for signing. Their
public keys remain in JWKS during the verification grace period. Complete a
pilot sign-in to initialize an RSA key on an upgraded database, then confirm
that the issuer advertises RS256 and JWKS contains the signing key.

## Rotate the issuer signing key

Run the key command as a restricted operator with database owner credentials
and the same `AUTH_SECRET` as the API. Supply the currently active RSA key's
`kid` and record the replacement `kid` printed by the command.

```sh
vpx packages/auth/scripts/signing-keys.ts stage "$IAM_ACTIVE_KID"
```

Verify the replacement appears at the issuer's `jwks_uri` on every replica.
Keep issuing with the current key while relying applications' JWKS caches
refresh. Allow the longest cache lifetime used by the pilot clients before
switching. Pass the same active `kid` and the staged replacement `kid`.

```sh
vpx packages/auth/scripts/signing-keys.ts activate "$IAM_ACTIVE_KID" "$IAM_STAGED_KID"
```

Complete a new sign-in through each replica and verify the replacement
`kid` on the ID token. Retired keys remain published during the 30-day
verification grace period. The command marks a staged or retired key
inactive five minutes in the past to allow for clock differences between
replicas. For an operational rollback, use
`activate` with the replacement as the expected active key and the previous
key as its replacement. Restore a previous key only if it remains trusted
and published. A compromised key requires incident containment.
[OIDC key rotation](https://openid.net/specs/openid-connect-core-1_0.html#RotateSigKeys)

Rehearse with a fresh disposable database before staging.

```sh
AUTH_SIGNING_KEY_ROTATION_TEST="true" AUTH_TEST_DB_PORT="55439" \
  vp test packages/auth/tests/signing-keys.integration.test.ts
```

## Run OpenID conformance

Use the OpenID Foundation's **Config OP** plan with the HTTPS discovery URL.
The plan verifies discovery metadata and the public key set. Suite
`release-v5.3.4` passed Config OP against local HTTPS ingress. Its
`oidcc-ensure-request-with-valid-pkce-succeeds` module also passed with a
registered client, browser sign-in, and the new UserInfo endpoint. IAM
advertises the claims used for app sign-in. Profile data stays in IAM. The
`oidcc-server-rotate-keys` module passed the public-key publication check.
The signing-key rehearsal verifies signing and rollback across two pools.

Repeat Config OP against the staging issuer. For the Basic OP plan, register
dedicated staging clients with the authentication methods and exact callback
URL in the Foundation's setup instructions. The standard `oidcc-server`
module in `release-v5.3.4` generated an authorization request without PKCE
in the local fixture. IAM requires S256 PKCE for every registered client.
The passing PKCE module covers that flow. Full Basic OP conformance remains
pending.
[OpenID Provider conformance instructions](https://openid.net/certification/connect_op_testing/)
