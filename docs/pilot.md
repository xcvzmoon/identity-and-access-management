# Deploy and rehearse the IAM v1 pilot

## Prepare the issuer and database

Choose the production issuer hostname before registering any external client. Record its bare HTTPS origin in the deployment inventory. Configure a separate console hostname and obtain TLS certificates for both. Use disposable identities and a separate database for the rehearsal. Arrange for browsers and backend services to resolve and trust the same issuer URL.

Provision PostgreSQL 18 for both APIs. The migrations use its built-in UUIDv7 generator. Create separate migrator logins and the runtime logins `iam_idp_runtime` and `iam_console_runtime`. Grant each migrator database CREATE and CONNECT so it can own its schema and migration journal. Create the audit reader and retention group roles before applying migrations. Keep migration credentials in the release environment. [Database roles and audit retention](local.md#database-setup)

From a checkout at the deployment revision, install locked dependencies with `vp install`. In each API's release shell load its environment and substitute its migrator database credentials. Apply migrations once per API, then start the runtime processes with their respective runtime logins.

```sh
vp -C apps/idp/api run db:migrate
vp -C apps/console/api run db:migrate
```

## Monitor database connection admission

Run the [database admission check](../deploy/sh.check-database-admission.sh) from the API network against each PostgreSQL primary serving IAM. Point it directly at the database so each run opens a fresh server connection. Use a dedicated login with CONNECT on the IAM database, ordinary connection privileges and no application table grants. Configure `PGHOST`, `PGDATABASE`, `PGUSER`, the port and TLS trust as for the APIs. Supply the password through a protected libpq password file.

```sh
sh deploy/sh.check-database-admission.sh
```

Exit 0 confirms that the writable server admitted an ordinary login and answered a query. Exit 2 means the monitor could not establish that session. Check connection-slot usage, primary availability, TLS and login configuration when investigating. Exit 3 means the monitor needs configuration. Have the monitoring agent enforce a wall-clock timeout and page on repeated failures, including timeouts. Set the interval and alert delay from the deployment's availability target.

Rehearse on a disposable primary with a small connection limit. Hold enough ordinary connections to exhaust the available slots, verify exit 2, then release them and verify exit 0. Confirm both notifications with the database on-call. This check covers connection exhaustion. Pool wait time, CPU and storage saturation need separate measurements.

### Measure database sessions during a capacity rehearsal

Sample the [database session report](../deploy/sql.report-database-sessions.sql) while the sign-in, token exchange and introspection workloads run. Connect to each IAM database on the primary using a DBA-controlled statistics login with `pg_read_all_stats`. Keep that privilege off the application and connection-admission logins.

```sh
psql -Xw --csv -f deploy/sql.report-database-sessions.sql
```

Each sample returns a timestamp and aggregate counts for both runtime roles in the connected database. Record the sampling interval alongside the workload and request latencies. A session waiting on a lock can also count as active. A nonzero `activity_tracking_disabled` count means the state breakdown is incomplete. Short waits can fall between samples. Measure application-side pool checkout delays separately.

## Monitor pending account email

Each IdP process emits an `account-email-backlog` event at startup and every minute. `pendingDeliveries` includes submissions waiting for an SMTP connection and those awaiting a relay response. `oldestPendingMs` is the age of the oldest outstanding submission in that process. Both fields return to zero when all submissions settle. Use the collector’s replica identifier when inspecting the samples.

The IdP waits up to `SMTP_CONFIRMED_TIMEOUT_MS` (default 30,000 milliseconds) for the relay to accept an invitation email. The deadline starts when the IdP submits the message and includes time waiting for a pooled connection. Apply the owner and member invitation delivery migrations before deploying the IdP. A successful owner, administrator, or member invitation response means the invitation and its delivery request have committed. Each replica checks both PostgreSQL queues independently every two seconds and sends the email after releasing the database lock.

A failed or interrupted invitation delivery becomes eligible again one minute plus the configured SMTP deadline after its last claim. A later attempt checks that the invitation is pending and unexpired. If the relay accepted an email before its acknowledgement was lost, the recipient may receive another copy of the same single-use link. The per-process backlog measures SMTP submissions. Run the [invitation backlog check](../deploy/sh.check-invitation-backlog.sh) against the IdP primary to monitor work across replicas, including time between attempts. Age starts at invitation creation and continues until the queue entry is removed. Owner bootstrap and recovery appear as `owner`. Member and administrator invitations appear as `member`.

Alert on `invitation-delivery-expired` events. A worker emits one when it removes a still-pending invitation whose link has expired. The `queue` field identifies the owner or member queue. If `previouslyClaimed` is false, check worker availability and backlog age. If true, check relay failures and worker restarts. A claim alone does not establish whether the relay accepted the message. A fresh invitation requires the usual authorization.

Apply the `invitation_delivery_backlog` migration and grant the monitoring login database CONNECT, schema USAGE and EXECUTE on `iam_idp.invitation_delivery_backlog()`. The function returns a count and oldest age for each queue, including zeros for empty queues. It requires no table grants for the monitoring login.

Configure libpq credentials, TLS and a wall-clock timeout as for the database admission check. Run the check at the agreed monitoring interval with the end-to-end invitation deadline in milliseconds. For example, a five-minute deadline uses `sh deploy/sh.check-invitation-backlog.sh 300000`. Exit 2 means a queue exceeded the deadline or the monitor could not read the primary. Exit 3 indicates a configuration error or an invalid reading. Treat a missing queue, duplicate queue, or inconsistent count and age as lost monitoring coverage. Route alerts and recovery notifications to the identity on-call.

Configure the host monitor to pass the latest JSON event for each expected replica to [sh.check-mail-backlog.sh](../deploy/sh.check-mail-backlog.sh) on standard input. Run it every minute, even if the collector has received nothing. Use an empty input for a missing replica. The argument is the relay acceptance deadline in milliseconds, chosen by the service owner. For example, to check a 30-second deadline, run:

```sh
sh deploy/sh.check-mail-backlog.sh 30000 < latest-replica-sample.json
```

The check requires jq. Exit 0 means the latest sample is within the deadline. Exit 2 signals an overdue delivery or a problem with the sample, including a timestamp older than three minutes or ahead of the monitor clock. Exit 3 signals a monitor configuration error.

Page the identity on-call when the oldest pending delivery on any replica exceeds the agreed relay acceptance deadline. Treat missing samples as lost visibility. Inspect `account-email-delivery` failures alongside the backlog because a rejection also removes the submission from the pending count. Each failure event records the delivery mode and elapsed milliseconds from submission. A `reason` of `smtp_reply` includes the numeric `smtpResponseCode`. A `submission_deadline` means the confirmed send exhausted its time budget. Other failures use `delivery_error`. The event omits relay text, addresses and account links. After a restart the counters describe the new process. Confirm delivery and recovery notifications with the on-call team during deployment rehearsal.

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

When updating the Node base image, inspect the chosen tag with `docker buildx imagetools inspect node:<tag>`. Pin the top-level index digest in the Dockerfile and check that the index includes each deployment architecture.

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
vpx apps/idp/api/scripts/ts.provision-console.ts < "$COOKIE_FILE" > "$NEW_SECRET_FILE"
```

After provisioning, the audit reader can check the `created` event for `iam-console` in `iam_idp.oauth_client_events`. Its `actor_user_id` identifies the verified operator who ran the command.

Store the returned value as `OIDC_CLIENT_SECRET` in the console runtime environment. Remove the temporary credential files and end the provisioning session. Start all services with `docker compose up -d`. For the Portless stack, run `vp run docker:portless up -d`. Check that discovery returns the exact issuer and open `/account` on the console origin. Configure daily audit retention with its dedicated login. [Audit retention](local.md#audit-retention)

Register the reference installation through the console, grant a test member a role with `reports.read`, and run its backend behind a separate HTTPS hostname. [Connect a server-backed app](client-integration.md) · [Start the reference app](local.md#sign-in-through-the-reference-app)

## Rotate a managed client secret

For the console, use a verified operator session and set `CLIENT_ID` to `iam-console`. For a customer installation, use a verified session belonging to an owner of that organization and set `CLIENT_ID` to the installation client ID. Verify a passkey in the same session within five minutes of rotation.

The provider accepts one secret at a time. Prepare the consumer's secret store and reload procedure, and coordinate a maintenance window for token exchange and introspection. Before invoking the command, you can abort the cutover and keep using the current secret. Run from a trusted host with the IdP runtime settings. Supply the session cookie in a private file and choose a fresh path for the replacement.

```sh
(umask 077; set -C; vpx apps/idp/api/scripts/ts.rotate-client-secret.ts "$CLIENT_ID" < "$COOKIE_FILE" > "$NEW_SECRET_FILE")
```

On success, install the captured value in the console or customer backend and reload every replica. Check a protected request and confirm the previous secret receives a client authentication error. The old secret stops working at commit. If the new value is lost, repeat rotation to issue another one. Use the same procedure for a suspected disclosure, with immediate cutoff. The audit reader can verify an `updated` event with `credential_changed` and the expected actor. End the privileged session and remove the temporary files after delivery.

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

### Verify the release manifest before promotion

The release signer reviews the clean ten-case receipt, the build manifest and the four image digests. Test the application bundles extracted from the candidate images. Separate builds can produce different bundle contents from the same source revision.

Bind the exact bytes of the passing receipt to the manifest and sign it with OpenSSL 3 and an Ed25519 key:

```sh
receipt_hash=$(openssl dgst -sha256 -r "$PASSING_RECEIPT") || exit 1
jq --arg hash "${receipt_hash%% *}" '.release_receipt_sha256 = $hash' build-manifest.json > manifest.json || exit 1
openssl pkeyutl -sign -rawin -inkey "$SIGNING_KEY" -in manifest.json -out manifest.sig
```

On the promotion host, supply the public key and repository from deployment configuration and the commit from the approved release record. Use Node at the project version, Docker, OpenSSL 3 and jq. Run this command for each workspace before deploying any replica:

```sh
reference=$(sh scripts/sh.verify-release-image.sh "$TRUSTED_PUBLIC_KEY" manifest.json manifest.sig \
  "$APPROVED_COMMIT" idp/api "$IDP_API_REPOSITORY" "$PASSING_RECEIPT") || exit 1
```

The verifier pulls the Linux arm64 image by its signed digest, extracts `/app/.output` from a stopped container, and compares it with the workspace digest in the signed receipt binding. Deploy the returned repository and digest. Keep the signing key separate from the deployment host.

For the Compose pilot, set `IDP_API_REPOSITORY`, `IDP_WEB_REPOSITORY`, `CONSOLE_API_REPOSITORY` and `CONSOLE_WEB_REPOSITORY` from deployment configuration. Generate a fresh override in the release directory. Keep the manifest, signature, receipt, and override with that release.

```sh
sh scripts/sh.verify-release-compose.sh "$TRUSTED_PUBLIC_KEY" manifest.json manifest.sig \
  "$APPROVED_COMMIT" "$PASSING_RECEIPT" > verified-images.yaml &&
  docker compose -f compose.yaml -f verified-images.yaml config --quiet &&
  docker compose -f compose.yaml -f verified-images.yaml up -d --no-build
```

The override assigns the verified IdP API digest to both replicas. It removes local build instructions for all application services. The ingress image comes from the base Compose configuration.

### Review access and offboard a customer

1. Identify the organization, installation and scope of the request through the customer's established support contact. Have the organization owner review current owners, administrators, members, assignments and pending invitations. Record the review date and unresolved exceptions in the access review case.
2. For one person's app access, use **Revoke an assignment**. For organization departure, use **Remove a member** and review outstanding invitations for that person. Keep the case open while a usable invitation could restore access. If the departing person is the last owner, complete ownership transfer or verified owner recovery first. For a retired customer app, use **Disable an installation** and have its operator retire the stored client secret and application sessions.
3. Use a previously authorized customer session to check that the protected resource now denies access. Have the audit reader locate the committed changes by organization, actor and time. Record the outcome, including any customer-managed sessions or data that still need action.
4. For a deletion request, verify the requester's identity, identify the responsible organization and determine whether the account has other memberships. Give the privacy owner the inventory of affected account records, customer-held records, audit history and backup copies. That owner determines authorized deletion, required retention and backup expiry under the deployment policy. Record who carried out each approved action, the verification result and any remaining expiry date. Removing a membership alone leaves the IAM account in place.
5. Escalate loss of every owner credential through the verified recovery procedure. Escalate unexpected access after revocation to the identity on-call and customer app owner. Keep passwords, tokens, links and database extracts out of support cases.

Before onboarding, the service owner records the actual support and privacy contacts, their backups, hours of coverage and access review interval. Have the customer's own operator run the onboarding and offboarding steps and record any intervention that required a developer.
