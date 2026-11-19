# Validate changes

[Documentation index](README.md) · [Local setup](local.md)

## Workspace checks

Configure both API `.env` files, then run these commands from the repository
root. [Local setup](local.md#database-setup)

```sh
vp check
vp test --run
vp run typecheck
vp run build
```

The root suite includes workspace discovery checks. For a local startup
check, open both web apps, then request `GET /api/v1/auth/get-session` from
the IdP API and `GET /api/v1/hello` from the console API.
The APIs need a reachable database and their runtime credentials.
[Local database setup](local.md#database-setup)

## Better Auth evaluation

The engine evaluation has a separate lockfile and creates disposable PostgreSQL and TLS fixtures. Install PostgreSQL client and server tools and OpenSSL before running it. From the repository root, run the following commands.

```sh
pnpm -C evaluations/better-auth install --frozen-lockfile --ignore-scripts
pnpm -C evaluations/better-auth exec playwright install chromium
vp -C evaluations/better-auth run evaluate
vp -C evaluations/better-auth run typecheck
```

The fixture removes its temporary database and TLS material on exit. The OpenID Foundation runs used a statically registered web client with the suite's exact callback URL, `client_secret_basic`, response type `code`, and the default response mode for PKCE. [Evaluation results](history.md#phase-1--evaluate-better-auth)

## Integration tests

Use a separate disposable database for each fixture. The test commands retain their original phase numbers in environment variable names. Record the revision, settings, checks that ran, and checks that were skipped.

### Invitation signup and recovery

Create a disposable local PostgreSQL database named `iam_phase3_test`. Apply
the IdP migrations with its migrator credentials. Start Mailpit on loopback
and point the IdP's SMTP settings at its SMTP port (default `1025`). Start
the IdP API with the runtime role and the settings for that database.
[IdP setup](local.md#idp-account-flows)

From the repository root, export the same IdP runtime settings used by the
server and run the suite. Set the URLs to the loopback endpoints for the
running API and Mailpit's HTTP interface.

```sh
IAM_PHASE3_TESTS=1 \
IAM_PHASE3_API=http://127.0.0.1:65430 \
IAM_PHASE3_MAILPIT=http://127.0.0.1:8025 \
vp test --run apps/idp/api/tests/invitations.test.ts
```

Each run seeds new organizations, invitations and email addresses. The
tests follow links from delivered messages, check membership after concurrent
acceptance, and use two session cookies to verify password reset revocation.
Discard the fixture database and mailbox when finished.

### OIDC issuer and app grants

1. Create the disposable PostgreSQL database `iam_phase4_test`. Apply the
   IdP migrations using the migrator role. Point the IdP API at this database
   using the runtime role.
2. Start the IdP API and web workspaces. Route the HTTPS issuer's
   `/.well-known/*` and `/api/*` paths to the API and all other paths to
   the web server. [Local IdP setup](local.md#idp-account-flows)
3. Configure a separate HTTPS hostname for the reference app. For the
   command below, route `https://reports.localhost` to
   `http://127.0.0.1:8080`. Leave port 8080 available. The test starts
   the app and supplies the installation's credentials.
4. Set `IAM_AUDIT_READER_USER` and `IAM_AUDIT_READER_PASSWORD` in the test
   shell to the credentials of a fixture login with the `iam_audit_reader` role.
   Export the IdP runtime settings in the test shell, including the same
   `DB_DATABASE`, `OIDC_ISSUER_URL`, and `BETTER_AUTH_SECRET` as the API.
   For local TLS, replace the CA path below with the PEM file for your
   proxy's certificate authority. Run from the repository root.

```sh
vp -C apps/idp/api exec playwright install chromium

NODE_EXTRA_CA_CERTS="/absolute/path/to/local-ca.pem" \
IAM_PHASE4_TESTS="1" \
IAM_PHASE4_APP_ORIGIN="https://reports.localhost" \
IAM_PHASE4_APP_PORT="8080" \
vp test --run apps/idp/api/tests/oidc.test.ts
```

The fixture registers two installations, signs in through the reference
app, and checks SSO reuse and renewed consent after a role change. It also
checks tenant isolation, callback and PKCE enforcement, code replay, and
revocation before exchange. Discard the fixture database after the run.

### Live access across IdP processes

Create a disposable PostgreSQL database named `iam_phase5_test` and apply
the IdP migrations. Export its IdP runtime settings in the test shell.
Build the IdP web and API workspaces and install Chromium as described above.
Supply a local TLS certificate valid for both `localhost` and
`reports.localhost`. Both names must resolve to loopback.

```sh
NODE_EXTRA_CA_CERTS="/absolute/path/to/test-certificate.pem" \
IAM_PHASE5_TLS_KEY="/absolute/path/to/test-key.pem" \
OIDC_ISSUER_URL="https://localhost:56451" \
IAM_PHASE5_TESTS="1" \
vp test --run apps/idp/api/tests/live-access.test.ts
```

The fixture routes sign-in and sign-out to one API process and introspection
to a second process using the same issuer and database. Reserve ports 56451
through 56455 for the fixture. Discard the database after the run.

### Console session

Build all four workspaces. Apply both APIs' migrations to a disposable
`iam_phase6_test` database. Export the IdP runtime settings and set
`IAM_PHASE6_CONSOLE_DB_PASSWORD` for the `iam_console_runtime` role.
Use a trusted test certificate covering `localhost`, `console.localhost`,
and `reports.localhost`. Reserve loopback ports 56471 through 56477 and
install Chromium as described in the OIDC issuer fixture.

```sh
NODE_EXTRA_CA_CERTS="/absolute/path/to/test-certificate.pem" \
IAM_PHASE6_TLS_KEY="/absolute/path/to/test-key.pem" \
OIDC_ISSUER_URL="https://localhost:56471" \
IAM_PHASE6_TESTS="1" \
vp test --run apps/idp/api/tests/console-session.test.ts
```

The fixture provisions the console client and passes its secret directly
to the console API process. It starts with a verified user without
memberships and later grants the same user access to the reference app.

### Administration and owner recovery

Build all four workspaces, install Playwright Chromium, and apply both
APIs' migrations to a disposable PostgreSQL database named
`iam_phase7_test`. Export the IdP runtime settings and the console runtime
database password as in the console session fixture. Supply the audit reader
credentials described in the OIDC fixture. Start Mailpit on
loopback, configure the IdP SMTP settings to use it, and supply a local
test certificate covering `localhost`, `console.localhost`, and
`reports.localhost`. Reserve the issuer port and the next six ports.

```sh
NODE_EXTRA_CA_CERTS="/absolute/path/to/test-certificate.pem" \
IAM_PHASE6_TLS_KEY="/absolute/path/to/test-key.pem" \
IAM_PHASE7_MAILPIT="http://127.0.0.1:8025" \
OIDC_ISSUER_URL="https://localhost:56750" \
IAM_PHASE7_TESTS="1" \
vp test --run apps/idp/api/tests/administration.test.ts apps/idp/api/tests/passkey-session.test.ts
```

The browser fixture creates temporary operator and owner accounts, uses a
virtual WebAuthn authenticator, and reads the delivered invitations. It
exercises the hosted operator workflow, console app registration and role
assignment, tenant and session denials, and replacement-owner recovery.
The second test checks challenge binding across two IAM sessions for the
same user. Discard the fixture database and mailbox after verification.

### Audit access and retention

Create a disposable `iam_phase8_test` database and apply the IdP migrations.
Use a test administrator who can switch to the runtime, reader, and retention
roles. The SQL fixture rolls back its changes.

```sh
psql -X -d iam_phase8_test -f apps/idp/api/tests/audit-access.sql
```

Run the OIDC and owner recovery browser fixtures above with the migrated
database for each phase. Use separate runtime and reader logins so the
fixtures exercise the same permissions as the services.

With the console session fixture environment configured, run
`sh scripts/tests/verify-ingress-logs.sh` from the repository root. It checks
the fixture proxy and upstream process output for synthetic credentials. It also verifies the IdP reset route template and the console callback failure event.
Repeat the checks against the deployed proxy and its log sinks during the pilot.

### Signing-key rotation

Apply the IdP migrations to a disposable database with an empty keyring. Export the IdP runtime settings for that database and run the concurrency fixture from the repository root.

```sh
IAM_PHASE9_TESTS="1" vp test --run apps/idp/api/tests/signing-key-rotation.test.ts
```

The test checks concurrent publication, activation, overlap, and rollback. [Signing-key operations](signing-key-rotation.md)

## Packaged deployment

Rehearse against a fresh rewrite database with the two IdP API containers behind the same HTTPS issuer. Record the issuer and release for every run. [Deployment and recovery runbook](pilot.md) · [Recorded rehearsal](history.md#phase-10--rehearse-the-packaged-pilot-locally)
