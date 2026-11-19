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

## Integration tests

Use a separate disposable database for each fixture. The test commands retain their original phase numbers in environment variable names. Record the revision, settings, checks that ran, and checks that were skipped.

### Release integration gate

Run the ten required integration cases against a release candidate before promoting its images.
Run `vp install --frozen-lockfile` to activate the pinned Node runtime in workspace scripts. The runner checks its Node version before starting any fixture.
Build the four workspaces, provision the databases, mailbox, certificates and services described
in each phase below. Keep the phase 3 and 4 services available while the gate runs. Provision the phase 8 audit database as described below and install the PostgreSQL client on the runner. Phase 5 also requires curl and jq to exercise the introspection monitor during an outage and after recovery.

Create a private fixture directory outside the repository containing `phase-3.env`, `phase-4.env`,
`phase-5.env`, `phase-6.env`, `phase-7.env` and `phase-9.env`. Each file must set
`DB_DATABASE` to its corresponding disposable database, for example
`DB_DATABASE="iam_phase3_test"`. Put the other phase-specific settings shown below in that
file using double-quoted literal values. The runner overlays the file on the calling environment
and enables the phase's tests. Add `rotation.env` with the IdP runtime settings for a fresh
`DB_DATABASE="iam_rotation_test"`. This fixture registers the reserved console client and checks
immediate secret cutoff. Add a separate `phase-8.env` with the libpq settings for the
disposable audit fixture, including `PGDATABASE="iam_phase8_test"`. Use a new evidence directory outside the checkout under an existing parent.

```sh
vp run --no-cache test:release /private/path/fixture-env /private/path/release-evidence
```

Each phase writes its own Vitest JSON report. The gate checks the exit status, suite and case
outcomes, case count and required test titles. It exits on the first failure. A successful run
checks the phase 6 ingress logs, runs the audit-access SQL assertions and writes `passed.json`
with those results, the checkout revision and dirty flag, Node version, per-workspace build digests,
timestamps, phases and total passing case count. The runner compares the revision, dirty flag and
four build digests after each phase and after the SQL checks. A mismatch stops the run before the
receipt is written. Each digest covers relative paths, regular-file contents and symlink targets
in one local Nitro output directory.
Use a clean checkout with matching images for release evidence. Restrict access to failed
reports because test diagnostics can include fixture data. For a retry, provide a new evidence
directory. Record image digests alongside the receipt and run the packaged-deployment checks below.

### Invitation signup and recovery

Create a disposable local PostgreSQL database named `iam_phase3_test`. Apply
the IdP migrations with its migrator credentials. Start Mailpit on loopback
and point the IdP's SMTP settings at its SMTP port (default `1025`). Start
the IdP API with the runtime role and the settings for that database.
[IdP setup](local.md#idp-account-flows)

From the repository root, export the same IdP runtime settings used by the
server and run the suite. Set the URLs to the loopback endpoints for the
running API and Mailpit's HTTP interface. In the test shell, set `IAM_AUDIT_READER_USER` and `IAM_AUDIT_READER_PASSWORD` to a fixture login with the `iam_audit_reader` role so the suite can verify the invitee recorded on each membership event.

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

The release gate writes `password-sign-in-capacity.json` for the hosted password endpoint. One burst submits three correct passwords for a verified account. A second submits three incorrect passwords for that account. Each burst starts after the sign-in limit window and uses three concurrent requests. The timed interval includes password verification and response-body parsing. A successful rejection sample means the expected HTTP 401 and credential error arrived without a cookie. The audit reader must observe three issued and three rejected attempts in the web-form counters and three new sign-in events for the account. Set `IAM_PHASE3_PASSWORD_REPORT` to a new file path to collect this report in a standalone phase 3 run.

### Client secret rotation

Create a fresh loopback PostgreSQL database named `iam_rotation_test`, apply the IdP migrations, and export the runtime settings for that database. Run this opt-in test from the repository root:

```sh
IAM_ROTATION_TESTS=1 vp test --run apps/idp/api/tests/client-secret-rotation.test.ts
```

The fixture runs the rotation CLI for the console and a tenant installation. It checks authorization, immediate cutoff, console token introspection and grant preservation. It seeds a fresh passkey verification timestamp to exercise the credential operation.

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

The release gate writes `token-exchange-capacity.json` for eight single-use authorization codes issued to one confidential client. The fixture prepares each code with its own S256 verifier before timing begins. It redeems up to two codes at once and counts HTTP 200 responses with nonempty access and ID tokens, a bearer token type and a positive lifetime. The report records failures, successful exchanges per second, and nearest-rank p95 and p99 latency through receipt of the response body. With eight exchanges, both percentiles equal the slowest successful exchange. Set `IAM_PHASE4_EXCHANGE_REPORT` to a new file path to collect the report in a standalone phase 4 run.

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

The release gate writes `introspection-capacity.json` for 32 authenticated introspections of one active token on the second IdP process, with up to four requests in flight. Each success requires HTTP 200, the expected subject and client ID, and the reader permission. The sample reports failures, successful responses per second, and nearest-rank p95 and p99 for successful requests. Set `IAM_PHASE5_INTROSPECTION_REPORT` to a new file path to collect it during a standalone phase 5 run. Use a representative mix of clients and tenants for deployment sizing.

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
memberships and later grants the same user access to the reference app. The fixture also expires two pending logins, submits one callback, and checks that the next login clears expired transactions while preserving a live one. With 202 expired rows and one held row lock, two concurrent logins each remove 100 rows. After the lock is released, a third login clears the remaining two.

The release gate writes `console-login-capacity.json` alongside the phase reports. To collect it in a standalone phase 6 run, set `IAM_PHASE6_LOGIN_REPORT` to a new file path. On the warmed console, each sample starts 128 authorizations with up to eight requests in flight. The first starts with an empty expiry backlog. The second seeds 12,800 expired transactions. Seeding and final row counts fall outside the timed interval.

The report gives successful redirects per second, failed attempts, and nearest-rank p95 and p99 latency for successful redirects. Each sample must leave 128 live fixture transactions and clear its seeded backlog. These timings cover the console login endpoint through its authorization redirect. Password verification, token exchange, and live introspection require separate workloads.

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

The release gate writes `organization-capacity.json` after an owner has registered an installation and assigned a role. The fixture adds 249 members to the owner’s organization, then sends 24 authenticated organization detail requests through the console with up to four in flight. A successful response must contain all 250 expected members exactly once. The report records failures, successful reads per second and nearest-rank p95 and p99 latency through response-body parsing. Seeding and cleanup run outside the timed sample. Set `IAM_PHASE7_ORGANIZATION_REPORT` to a new file path to collect it during a standalone phase 7 run.

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
the fixture proxy and upstream process output for synthetic credentials. It also verifies the IdP reset route template, the successful password sign-in POST after its body-size check, and the console callback failure event.
Repeat the checks against the deployed proxy and its log sinks during the pilot.

### Signing-key rotation

Apply the IdP migrations to a disposable database with an empty keyring. Export the IdP runtime settings for that database and run the concurrency fixture from the repository root.

```sh
IAM_PHASE9_TESTS="1" vp test --run apps/idp/api/tests/signing-key-rotation.test.ts
```

The test checks concurrent publication, activation, overlap, and rollback. [Signing-key operations](signing-key-rotation.md)

## Packaged deployment

Rehearse against a fresh rewrite database with the two IdP API containers behind the same HTTPS issuer. Record the issuer and release for every run. [Deployment and recovery runbook](pilot.md) · [Recorded rehearsal](history.md#phase-10--rehearse-the-packaged-pilot-locally)
