# Deploy and rehearse the IAM v1 pilot

## Prepare the issuer and database

Choose the production issuer hostname before registering any external client. Record its bare HTTPS origin in the deployment inventory. Configure a separate console hostname and obtain TLS certificates for both. Use disposable identities and a separate database for the rehearsal. Arrange for browsers and backend services to resolve and trust the same issuer URL.

Provision PostgreSQL 18 for both APIs. The migrations use its built-in UUIDv7 generator. Create separate migrator logins and the runtime logins `iam_idp_runtime` and `iam_console_runtime`. Grant each migrator database CREATE and CONNECT so it can own its schema and migration journal. Create the audit reader and retention group roles before applying migrations. Keep migration credentials in the release environment. [Database roles and audit retention](local.md#database-setup)

From a checkout at the deployment revision, install locked dependencies with `vp install`. In each API's release shell load its environment and substitute its migrator database credentials. Apply migrations once per API, then start the runtime processes with their respective runtime logins.

```sh
vp -C apps/idp/api run db:migrate
vp -C apps/console/api run db:migrate
```

## Local rehearsal origins

For a local run, set `IDP_HOST="idp.localhost"` and `CONSOLE_HOST="console.localhost"`. Use a test certificate whose SANs include both names, signed by a locally trusted CA. Supply the certificate, key and root CA paths below. Use a recent Docker Compose release with support for the `!override` tag.

From the repository root in a POSIX shell, run `export COMPOSE_FILE="compose.yaml:compose.local.yaml"` before the Compose commands below. This binds ingress to loopback on port 56943 and sets both public origins to that port across the ingress and API containers. Set the same full origins in any host-side provisioning commands and client registrations. The packaged run used a loopback DNS alias for the issuer. [Recorded origins](history.md#phase-10--rehearse-the-packaged-pilot-locally)

## Start the services

From the repository root, supply the following settings to Compose. Keep secrets and private keys outside the build context. Use double quotes around dotenv values.

| Setting                            | Value                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDP_HOST`, `CONSOLE_HOST`         | Distinct DNS names without a scheme or port. The base deployment uses HTTPS on port 443.                                                          |
| `IDP_ENV_FILE`, `CONSOLE_ENV_FILE` | Absolute paths to protected runtime environment files. Use each API's `.env.example` as the starting point.                                       |
| `TLS_CERT_FILE`, `TLS_KEY_FILE`    | Full certificate chain covering both hosts and the corresponding private key.                                                                     |
| `TLS_CA_FILE`                      | PEM file with the CA trusted by the API containers. Install the same trust anchor on rehearsal browsers and client servers if using a private CA. |
| `BIND_ADDRESS`                     | Ingress listen address on the Docker host. The default is loopback. Set the interface address reachable through pilot DNS.                        |

Configure PostgreSQL and SMTP addresses reachable from inside the containers. Use `DB_SSL="true"` for remote PostgreSQL connections and provide its CA chain in the API trust bundle. Configure an authenticated TLS relay for remote email delivery. Disable database query logging in production. Keep the same `BETTER_AUTH_SECRET` and PostgreSQL primary across both IdP API replicas. Keep an independently recoverable copy of the secret alongside the credentials required for disaster recovery.

Build the workspace images and start the issuer. Use a protected temporary value for the console client secret if a value is required for initial configuration. Delay console traffic until its registration exists.

```sh
docker compose config --quiet
docker compose build
docker compose up -d idp-api-1 idp-api-2 idp-web
docker compose up -d --no-deps ingress
```

Provision a named operator from a trusted checkout. Verify the operator's email address and configure the approved user ID in the IdP runtime file. Run `docker compose up -d --force-recreate idp-api-1 idp-api-2` to load the updated allowlist. Sign in, enroll a passkey, and select **Verify passkey**. Use that session within five minutes. [Operator provisioning](local.md#provision-an-operator)

## Provision the console client

Sign in on the issuer as an allowlisted, verified operator and verify a passkey. Run the command within the five-minute step-up window.

Load the IdP runtime environment and set `CONSOLE_ORIGIN` to the public console HTTPS origin in a trusted provisioning shell. Load the same operator allowlist, issuer URL, and secret as the running replicas. Supply the operator session's Cookie header value through a protected file. Capture the issued secret in a new restricted file.

```sh
umask 077
vpx apps/idp/api/scripts/provision-console.ts < "$COOKIE_FILE" > "$NEW_SECRET_FILE"
```

Store the returned value as `OIDC_CLIENT_SECRET` in the console runtime environment. Remove the temporary credential files and end the provisioning session. Start all services with `docker compose up -d`. For the Portless stack, run `vp run docker:portless up -d`. Check that discovery returns the exact issuer and open `/account` on the console origin. Configure daily audit retention with its dedicated login. [Audit retention](local.md#audit-retention)

Register the reference installation through the console, grant a test member a role with `reports.read`, and run its backend behind a separate HTTPS hostname. [Connect a server-backed app](client-integration.md) · [Start the reference app](local.md#sign-in-through-the-reference-app)

## Back up and rehearse restore

1. From an authorized backup host, configure libpq credentials for a login with read access to both application schemas and migration journals. Preserve PostgreSQL role definitions and memberships in the deployment's administrator-managed configuration.
2. Create a consistent full-database archive with `pg_dump --format=custom --file="$ARCHIVE" --dbname="$SOURCE_DB"`. Restrict access to the backup and encrypt it in storage. Record its timestamp and corresponding release and secret versions.
3. On an isolated restore target, recreate the original role names and memberships. As an administrator, create a fresh empty database and run `pg_restore --exit-on-error --single-transaction --dbname="$RESTORE_DB" "$ARCHIVE"`. Retain object ownership and grants.
4. Start the matching images against the restored database with the original issuer secret. Use isolated DNS and trusted TLS for the same issuer origin. Direct email to a test inbox. Verify both migration journals, runtime isolation, console sign-in, an installation grant, audit access, and signing with the expected key ID.
5. Measure the age of the recovered data and elapsed recovery time. Restrict real ingress until operators reconcile grant revocations, ended sessions, and key retirements that occurred after the backup. Restoring older authorization state can re-enable access. Apply the backup retention policy to the rehearsal copy.

## Roll back and recover

Record the running image IDs, deployment revision, configuration versions, and backup before replacing a release. If the previous release supports the current schema, redeploy its images with their matching configuration. Check discovery, JWKS, and a protected request through each replica. If schema compatibility is unknown, stop ingress and writers and rehearse the previous release against an isolated restored copy before switching traffic. Use a new database for restore so the failed deployment remains available for reconciliation.

For a locked-out organization, verify the recovery request through an independent organization contact, then use a stepped-up operator session to issue a replacement-owner invitation. Confirm acceptance, new passkey enrollment, and the case entry in the audit trail. [Owner recovery procedure](local.md#recover-a-locked-out-organization)

For key rollover, check that both replicas publish the staged key before activation. Verify tokens signed before and after activation. Roll back to a retained trusted key and verify a fresh token through the public issuer. Follow the incident procedure for a compromised key. [Signing-key operations](signing-key-rotation.md)

## Decide whether to open the pilot

Record the date, release, issuer, console origin, image IDs, database migration versions, replica names, and outcome for each check. Keep the evidence free of tokens, client secrets, credentials, and invitation links.

- Complete console and reference-app sign-in. Verify another installation cannot access the test resource.
- Revoke the user's grant on one replica. Verify the next protected request via the other replica denies access. Repeat for IAM sign-out.
- Stop one IdP API replica. Verify discovery, JWKS, and a fresh sign-in through ingress. Restore it, then interrupt the reference app's path to introspection. Verify it withholds protected data until access checks succeed again.
- Exercise owner recovery, signing-key rollover and rollback, and database restore. Record the post-recovery checks and the observed key IDs.
- Check deployed ingress and application log destinations for exposure of synthetic test credentials. Run the workspace, PostgreSQL permissions, and browser checks with the documented test settings. [Validation procedures](validation.md)

The OpenID Foundation evaluation passed discovery and one positive confidential-client PKCE test on the evaluation fixture. Full Basic OP coverage remains open. The Basic OP plan also exercises code exchange and reuse, redirect URI matching, token signatures, UserInfo, scopes, prompt and session behavior, request objects, and client authentication. Its `client_secret_post` variant exceeds the v1 installation profile, which registers `client_secret_basic`. Its refresh-token case depends on advertised support. Discovery is a separate test. [Basic OP module list for release-v5.3.4](https://github.com/openid-certification/conformance-suite/blob/release-v5.3.4/src/main/java/net/openid/conformance/openid/OIDCCBasicTestPlan.java)

Run `oidcc-basic-certification-test-plan` for a statically registered confidential code client against the packaged issuer. Record the suite version, variants, each remaining module's result or reason for exclusion, and unresolved failures. Obtain a release decision on that record before onboarding an external client. [Conformance results and run IDs](history.md#phase-1--evaluate-better-auth)

For this review, the product issues authorization codes to statically registered web clients and requires S256 PKCE and `client_secret_basic`. The Basic OP test setup calls for two Basic-authenticated registrations to check client binding and a third registration supporting `client_secret_post`. IAM's registration service issues Basic-authenticated clients only. Record that mismatch in the conformance decision. The application fixtures exercise code exchange, issuer and audience checks, and installation isolation. The remaining suite modules have no recorded result for this release. [OpenID Foundation OP testing instructions](https://openid.net/certification/connect_op_testing/)
