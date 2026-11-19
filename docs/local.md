# Run the IAM workspaces locally

[Documentation index](README.md) · [Workspace reference](development.md)

## Docker with Portless

Run this setup from the repository root. Portless assigns a loopback port to each of the two public ingress containers. The host Portless CA secures browser requests. The internal ingress certificate secures calls to the issuer from inside Docker. The issuer and console keep separate HTTPS origins. Both IdP API replicas share the issuer. The console API resolves that same hostname on the Compose network for discovery and token exchange. [Portless Docker Compose commands](https://portless.sh/commands#docker-compose)

1. Install Vite+ and Docker Compose with support for the `!override` tag. Run `vp install` from the repository root. Copy each API's `.env.example` to a private runtime file. Use database and SMTP addresses reachable from Docker and double-quote every value. Generate the IdP secret with `openssl rand -base64 32`. Use an existing console client secret or a temporary nonempty value for bootstrap. If you supply PostgreSQL, apply both APIs' migrations before starting the stack. [Runtime settings](#database-setup)
2. Copy `.env.portless.example` to `.env.portless`. Set `IDP_ENV_FILE` and `CONSOLE_ENV_FILE` to the runtime files. For services on an external Docker network, append a machine-local Compose override to `COMPOSE_FILE` that names that network.
3. Provide a certificate covering `idp.iam.localhost` and `console.iam.localhost` for HTTPS **inside Docker**. The following commands create the files used by the example configuration. Run them once on a new setup. Renew the certificate before it expires and recreate the ingress and API containers. If PostgreSQL or SMTP uses another private CA, include its public certificate in the bundle specified by `TLS_CA_FILE`.

   ```sh
   umask 077
   mkdir -p .env.portless.d
   openssl req -x509 -nodes -newkey rsa:2048 -days 90 \
     -subj "/CN=idp.iam.localhost" \
     -addext "subjectAltName=DNS:idp.iam.localhost,DNS:console.iam.localhost" \
     -keyout .env.portless.d/ingress.key -out .env.portless.d/ingress.pem
   ```

4. Start the host Portless proxy. Use port 1355 when another service owns port 443. On a machine with port 443 available, use `vp exec portless proxy start --https` for port-free URLs. Trust the Portless CA in your user account when prompted.

   ```sh
   vp exec portless proxy start --https -p 1355
   vp exec portless trust
   ```

5. For the bundled local database and inbox, complete the [container setup](#optional-postgresql-and-mailbox-containers) now. Run `vp run docker:portless up -d --build` and check the routes with `vp exec portless list`.
6. Confirm discovery at `https://idp.iam.localhost:1355/.well-known/openid-configuration`. Its `issuer` field must equal the public issuer origin. Use the origins printed by `vp exec portless list` if your proxy uses another port.
7. For a fresh database, provision an operator and the reserved console registration. Use the exact Portless origins in the provisioning shell. The callback is `/api/v1/callback` on the console origin. Reapply the stack with `vp run docker:portless up -d` after changing the allowlist or console secret. [Operator provisioning](#provision-an-operator) · [Console provisioning](pilot.md#provision-the-console-client)
8. Open `https://console.iam.localhost:1355/account` and sign in with the verified account.

Use `vp run docker:portless ps` for service status and `vp run docker:portless down` to stop the IAM project and remove its routes. Portless keeps its shared host proxy running. The standalone pilot deployment has its own ingress settings. [Pilot deployment guide](pilot.md)

### Optional PostgreSQL and mailbox containers

To run the dependencies in the same project, append `:compose.portless-infra.yaml` to `COMPOSE_FILE` in `.env.portless`. This adds PostgreSQL 18 and a local Mailpit inbox with named volumes. The database listens on host loopback port 56985 and the inbox at `http://localhost:56986`.

Before the first start, generate the local administrator password and the mailbox's STARTTLS certificate. Keep the generated files in the private directory created above.

```sh
umask 077
openssl rand -hex 32 > .env.portless.d/postgres-password
openssl req -x509 -nodes -newkey rsa:2048 -days 90 -subj "/CN=mail" \
  -addext "subjectAltName=DNS:mail" \
  -keyout .env.portless.d/mail.key -out .env.portless.d/mail.pem
cat .env.portless.d/ingress.pem .env.portless.d/mail.pem > .env.portless.d/ca.pem
```

Set `TLS_CA_FILE="./.env.portless.d/ca.pem"`. Configure the API runtime files with `DB_HOST="database"`, `DB_PORT="5432"`, and `DB_DATABASE="iam_portless"`. Use `SMTP_HOST="mail"` and `SMTP_PORT="1025"` for the IdP. Set `DB_SSL="false"` for the bundled PostgreSQL instance. Start the dependencies with `vp run docker:portless up -d database mail`. The image creates the database on first start. Create the [database roles](pilot.md#prepare-the-issuer-and-database) as the database administrator and run each API's migrations from the host using its migrator login on `127.0.0.1:56985`. Once both schemas exist, start the full project and provision the console as described above.

When you run provisioning commands on the host, set `DB_HOST="127.0.0.1"` and `DB_PORT="56985"` and use the IdP runtime credentials. The bundled mailbox exposes only its HTTP inbox on the host. After creating the operator, use **Resend verification email** on the issuer sign-in page to send the link through the container's SMTP connection. Open the link in Mailpit, then use **Forgot password** to set the operator's password.

## Run individual workspaces

Install Vite+ and run `vp install` from the repository root. Start each workspace in a separate terminal. Prepare PostgreSQL before starting either API. The web workspaces can start independently. [Database setup](#database-setup)

| Workspace   | Command                          | Local address                                    |
| ----------- | -------------------------------- | ------------------------------------------------ |
| IdP web     | `vp -C apps/idp/web run dev`     | `http://localhost:3000` by default               |
| IdP API     | `vp -C apps/idp/api run dev`     | `http://localhost:65430/api/v1/auth/get-session` |
| Console web | `vp -C apps/console/web run dev` | `http://localhost:3001`                          |
| Console API | `vp -C apps/console/api run dev` | `http://localhost:65431/api/v1/hello`            |

Use the port printed by the dev server if the default is busy. Without a session cookie, the IdP session endpoint returns JSON `null`.
The console greeting returns `{"message":"Hello from Nitro!"}`. Use the public HTTPS issuer for the hosted account flows.

## Database setup

1. Create a fresh database on PostgreSQL 18. Create one migrator login per API and the runtime logins `iam_idp_runtime` and `iam_console_runtime`. Grant `CONNECT` and `CREATE` on the database to each migrator and `CONNECT` to each runtime role. The migrations grant access to the application objects.
2. Have the PostgreSQL administrator create the two cluster-wide group roles
   with `CREATE ROLE iam_audit_reader NOLOGIN` and
   `CREATE ROLE iam_audit_retention NOLOGIN` before applying the IdP migrations.
   Grant the first role to security reviewers and the second to a dedicated
   scheduler login. Keep these memberships separate from API runtime accounts.
3. Apply each API's migrations in a separate shell. For each command, export
   `DB_HOST`, `DB_DATABASE`, `DB_USER`, and `DB_PASSWORD` for its migrator.
   Set `DB_PORT` and `DB_SSL` if your connection differs from the local defaults.

   | API     | Command                                 |
   | ------- | --------------------------------------- |
   | IdP     | `vp -C apps/idp/api run db:migrate`     |
   | Console | `vp -C apps/console/api run db:migrate` |

4. In each API directory, copy its `.env.example` to `.env` if needed. Fill in
   the matching runtime credentials and double-quote dotenv values. Use the
   local setup commands in shells with the runtime environment.
   [IdP example](../apps/idp/api/.env.example) · [Console example](../apps/console/api/.env.example)

Both APIs require `OIDC_ISSUER_URL`. The console API also requires
`CONSOLE_ORIGIN` and the reserved client's `OIDC_CLIENT_SECRET`. Use bare HTTPS origins, with no trailing slash. The
examples use `https://idp.localhost` and `https://console.localhost`. Use the direct HTTP ports above for smoke checks.

Each migrator owns its application schema and journal schema. The runtime
role can read and write ordinary application tables. The IdP runtime has append-only
access to authorization and owner recovery events. PostgreSQL supplies their IDs and timestamps. Drizzle needs
database `CREATE` for each migrator to initialize or check the journal
schema. Runtime roles have `CONNECT` and grants on their own application data.

### Audit retention

The IdP retains authorization and owner recovery events for 90 days. Configure
a daily scheduler job to run `apps/idp/api/scripts/purge-expired-audit-events.sh`
with the retention login's libpq connection settings. Each call removes up to
1,000 expired rows per event table and clears expired daily sign-in counts. The job stops when it finds no unlocked expired
rows. Alert on a failed or missed run. Rows become eligible at 90 days and
are normally removed by the next daily run. Apply a separate expiration
policy to backups and restored copies. After expiry, the IdP keeps only a digest
of the organization and case reference to prevent repeat recovery for the same case.

The same job removes up to 1,000 rate-limit keys per call once their last request is more than 720 hours old, including when authentication traffic stops. Run it daily to limit the time between eligibility and deletion. Keep authentication rate-limit windows below that interval. Apply the rate-limit retention migration before updating the job. For a busy existing table, first build `rate_limits_last_request_idx` concurrently on `iam_idp.rate_limits (last_request)` and verify the index is valid.

Security reviewers can query the audit tables. The retention role can run
the fixed purge functions. Schema owners and database administrators retain
privileged access. Keep migrator credentials out of the API and scheduler.
For a busy existing deployment, build the two retention indexes from the
audit migration with `CREATE INDEX CONCURRENTLY` before applying it, and
verify both indexes are valid. The migration reuses those indexes. When upgrading an installation that predates restricted audit access, deploy the compatible IdP API to every replica before the audit migration tightens its grants. See the recorded rollout in the project history. [Audit history](history.md#phase-8--restrict-audit-access-and-expire-events)

#### Schedule retention on a Linux host

On a systemd host with the PostgreSQL client installed, place the purge script at `/usr/local/libexec/iam/purge-expired-audit-events.sh`. Copy [iam-retention.service](../deploy/systemd/iam-retention.service) and [iam-retention.timer](../deploy/systemd/iam-retention.timer) into `/etc/systemd/system/`. Configure the retention login's host, port, database, username and TLS settings as libpq environment variables in `/etc/iam/retention.env`. Put its matching password entry in `/etc/iam/retention.pgpass`, owned by root with mode 0600. The service manager supplies a private copy to the job. Make any configured CA certificate readable by the service.

After applying the retention migrations, run:

```sh
systemctl daemon-reload
systemctl start iam-retention.service
systemctl enable --now iam-retention.timer
systemctl list-timers iam-retention.timer
journalctl -u iam-retention.service
```

The timer runs daily at 02:00 UTC and catches up after host downtime. Monitor service failures and alert if a successful completion is overdue. Enabling this timer runs the purge against the database named in the environment file.

### Password sign-in telemetry

The IdP counts password sessions issued and requests rejected by Better Auth (HTTP 4xx)
for each UTC day and entry point. `web_form` means the sign-in or invitation form's
public endpoint, `/api/v1/web/sign-in/email`. `api` means the original
`/api/v1/auth/sign-in/email` endpoint. Any HTTP client can call either route.
These values establish which endpoint handled a request. They cannot identify
curl, Postman, a browser, or a person operating that browser.

Each issued password session also creates a security record containing the account
UUID, database time, and entry point. Session creation and the two telemetry writes
commit together. Rejections increment a counter only. Invalid origins, requests
rejected before Better Auth, server failures, passkey step-up, and SSO session reuse
are outside the counts. Collection starts when the updated API handles traffic.
Existing sessions have no historical entry-point information.

Use a read-only audit login for an authorized account investigation. In psql, set
the account UUID with `\set account_id '...'` and run:

```sql
SELECT created_at, entry
FROM iam_idp.sign_in_events
WHERE user_id = :'account_id'::uuid
ORDER BY created_at DESC;
```

For service reporting, grant the reporting login schema `USAGE` and `SELECT`
on `iam_idp.sign_in_counts` alone. The following query returns daily totals:

```sql
SELECT day, entry, outcome, total
FROM iam_idp.sign_in_counts
ORDER BY day DESC, entry, outcome;
```

The daily retention job above removes account history older than 30 days and
keeps the current UTC day plus 89 previous days of counts. Deploy the migration
before the API and web updates, and schedule the job before enabling traffic.
Restrict access to backups and expire them under the deployment's backup policy.
The telemetry tables omit emails, IP addresses, user agents, session identifiers,
and credentials. Better Auth's existing session metadata has a separate lifecycle.
The sign-in and invitation forms disclose collection. Before production, document
the deployment's lawful basis, investigation access, privacy contact, and retention
in its privacy notice. The windows here are operational defaults.

## IdP account flows

Serve the IdP web and API workspaces under the HTTPS origin in
`OIDC_ISSUER_URL`. Configure your reverse proxy to send `/.well-known/*` and
`/api/*` to the IdP API. Send all other paths to the IdP web server.
Preserve the public host. Configure ingress access logs to record only the
method, route template, status, and duration. For unmatched routes, use a
fixed label. Raw paths can contain password reset tokens, and callback queries
carry authorization codes. Omit headers, bodies, and redirect targets from
access and error logs on both hosts. If the API accepts traffic exclusively from a trusted proxy that
overwrites `X-Real-IP` with the client address, set `TRUST_PROXY_IP="true"`
to rate-limit individual clients behind that proxy.

Set `BETTER_AUTH_SECRET` to a random secret shared by every IdP replica.
Generate one with `openssl rand -base64 32`. Configure `SMTP_HOST`,
`SMTP_PORT`, and `SMTP_FROM`. Set both `SMTP_USER` and `SMTP_PASSWORD` if
the relay requires authentication. Use a loopback SMTP inbox for local
tests. Remote SMTP relays must support TLS.

Open `/sign-in` for an existing account. Send invitees a link to
`/invite#token=<invitation-token>`. A new user verifies their email and
signs in to accept. A verified existing user can sign in and accept
directly. The invitation grants membership only to its invited address.

## Sign in to the console

Serve the console on its own HTTPS hostname. Route `/api/*` on that host to
the console API and all other paths to the console web server. Keep cookies
and callback query strings out of proxy logs.

The console uses the reserved `iam-console` registration. Provision it with the exact callback on the console origin and give the console API the returned secret. [Provision the console client](pilot.md#provision-the-console-client)

Open `/account` on the console origin. A verified account can view its
profile and start password recovery without an organization membership.
**Sign out of console** ends the local session. **Sign out of IAM** also
opens the issuer's confirmation page to end SSO in this browser.

## Sign in through the reference app

Give the app its own HTTPS hostname, such as `https://reports.localhost`.
Configure TLS for both hostnames and route the app hostname to
`http://127.0.0.1:8080`. The browser and the app server must be able to
reach the issuer by its public hostname.

Use the installation's confidential client credentials. Its registration
must include the exact callback URL `https://reports.localhost/callback`.
Assign an organization member a role for that installation. The [browser
fixture](validation.md#oidc-issuer-and-app-grants) provisions both for a test run.

Export `CLIENT_ID` and `CLIENT_SECRET` in the app server's shell. If your
TLS proxy uses a local CA, set `NODE_EXTRA_CA_CERTS` to its PEM file.
Start the app from the repository root.

```sh
OIDC_ISSUER_URL="https://idp.localhost" \
APP_ORIGIN="https://reports.localhost" \
PORT="8080" \
vp -C examples/reference-app run start
```

Open `https://reports.localhost` and choose **Sign in with IAM**. Sign in as
the assigned member and review the app, organization, and role. On approval,
the app validates the ID token and starts an application session. The
Reports installation needs a role with the `reports.read` permission.
Configure the installation's role permissions when calling `provisionClient`,
for example `rolePermissions: { reader: ['reports.read'] }`. The app checks
the current grant with IAM before serving the signed-in user's report.
For Portless, set `OIDC_ISSUER_URL` to the full Portless issuer origin and use the host Portless CA for Node.js. The reference server keeps its app sessions in memory. Restarting it requires
users to sign in again.

The OAuth provider's default introspection limit is 100 requests per peer IP
per minute. Each protected report request consumes one check. Account for
backends sharing an egress address when sizing that limit. A throttled check
makes the report unavailable.

Open `/sign-out` at the issuer and choose **Sign out of IAM** to end the
current browser's SSO session. The next protected request using that session
will be denied, even if the access token has time left.

## Organization administration

Apply both APIs' migrations before using management. If you upgraded from a console that did not retain an IAM access token, sign in again to establish a management session.

### Provision an operator

Use a named operator account with an independently confirmed email address.
Export the IdP API runtime settings in a trusted shell. Set `OIDC_ISSUER_URL` to the exact issuer origin, including its port when present. Run the command from the repository root.

```sh
vpx apps/idp/api/scripts/provision-operator.ts operator@example.org "IAM operator"
```

The command prints the IAM user ID. For a new account it sends an email
verification link and generates a random password. The operator verifies
the address and uses the IdP's **Forgot password** form to set their
password. Running the command again for an existing account returns its
ID and preserves its credentials.

Set `OPERATOR_USER_IDS` on every IdP replica to a comma-separated list of
approved IAM user IDs and restart the replicas. An empty list disables
operator operations. To withdraw operator access, remove the ID and restart
all replicas.

### Onboard an organization

1. Sign in on the IdP origin. Visit `/passkeys`, enroll a passkey, and
   select **Verify passkey**. Verification lasts five minutes in this IAM
   session. To enroll another passkey, first verify with an existing one.
2. Open `/operator` on the same origin. Enter the organization name, unique
   slug, and first owner's email. The owner invitation expires after 48 hours.
3. The owner follows the emailed link and accepts using a verified account
   with the invited address. The owner signs in to the console, opens
   **Manage organizations**, and uses the passkey link to enroll and verify on
   the IdP origin.
4. In the console, register the app with its exact HTTPS callback URL.
   Copy the issued client secret into the app's secret store. Define an
   installation role and its permissions, then assign it to a member.

Admins can invite and remove ordinary members. Owners can also invite
admins and remove a different admin or owner. Removing membership revokes
that user's installation grants in the organization.

### Recover a locked-out organization

1. Open a recovery case. Verify the organization ID, that every owner has
   lost access to their enrolled passkeys, and the replacement owner's
   email through an established organization contact independent of the
   request. Keep the verification evidence in the case system. Use a
   replacement address that is not already a member of the organization.
2. As an allowlisted operator, verify a passkey. Select **Open recovery** at
   `/operator`. Enter the organization ID, the case identifier from the case system, and the
   verified replacement address. The case identifier is stored verbatim in the
   audit trail. Keep evidence, credentials, and recovery links in their original systems. Confirm the verification and send the invitation.
3. The IdP cancels outstanding owner invitations and records the operator
   ID, organization ID, case reference, timestamp, and `invited` outcome
   when it issues the replacement invitation. Reusing that case reference
   for the same organization is rejected. A later reissue requires a new
   verified case reference.
4. Have the replacement owner accept, enroll a passkey, and verify it.
   Review existing owners and remove retired accounts from the organization.
   Recovery grants ownership through invitation acceptance. It preserves
   existing owners' credentials in any other organizations they administer.
