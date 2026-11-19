# Run the IAM workspaces locally

[Documentation index](README.md) · [Workspace reference](development.md)

## Local setup

Install Vite+ and run `vp install` from the repository root. Start each
workspace you need in its own terminal. Set up PostgreSQL before starting
the APIs. The web workspaces can start on their own.
[Database setup](#database-setup)

| Workspace   | Command                          | Local address                                    |
| ----------- | -------------------------------- | ------------------------------------------------ |
| IdP web     | `vp -C apps/idp/web run dev`     | `http://localhost:3000` by default               |
| IdP API     | `vp -C apps/idp/api run dev`     | `http://localhost:65430/api/v1/auth/get-session` |
| Console web | `vp -C apps/console/web run dev` | `http://localhost:3001`                          |
| Console API | `vp -C apps/console/api run dev` | `http://localhost:65431/api/v1/hello`            |

Use the port printed by the dev server if the default is busy. Without a session cookie, the IdP session endpoint returns JSON `null`.
The console greeting returns `{"message":"Hello from Nitro!"}`. Use the
HTTPS setup below to exercise the IdP account pages.

## Database setup

1. Create a fresh PostgreSQL database with `createdb iam_v1`.
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
with the retention login's libpq connection settings. Each call commits up to
1,000 expired rows per table. The job stops when it finds no unlocked expired
rows. Alert on a failed or missed run. Rows become eligible at 90 days and
are normally removed by the next daily run. Apply a separate expiration
policy to backups and restored copies. After expiry, the IdP keeps only a digest
of the organization and case reference to prevent repeat recovery for the same case.

Security reviewers can query both event tables. The retention role can run
the fixed purge function. Schema owners and database administrators retain
privileged access. Keep migrator credentials out of the API and scheduler.
For a busy existing deployment, build the two retention indexes from the
audit migration with `CREATE INDEX CONCURRENTLY` before applying it, and
verify both indexes are valid. The migration reuses those indexes. On an
existing installation, deploy the Phase 8 IdP API to every replica before
applying the migration. Earlier versions require broader audit table grants.

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

Use the reserved `iam-console` registration. To provision it in a fresh
environment, call the IdP's `provisionClient` from trusted provisioning
code with a verified session, `kind: 'console'`, a name, and an exact
redirect URI of `${CONSOLE_ORIGIN}/api/v1/callback`. Store the returned
client secret in the console API's `OIDC_CLIENT_SECRET` setting. Apply
both APIs' migrations. The IdP migration adds the profile and email scopes
to an existing console registration.

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
The reference server keeps its app sessions in memory. Restarting it requires
users to sign in again.

The OAuth provider's default introspection limit is 100 requests per peer IP
per minute. Each protected report request consumes one check. Account for
backends sharing an egress address when sizing that limit. A throttled check
makes the report unavailable.

Open `/sign-out` at the issuer and choose **Sign out of IAM** to end the
current browser's SSO session. The next protected request using that session
will be denied, even if the access token has time left.

## Containers

### Docker with Portless

Run this setup from the repository root. Portless assigns a loopback port to each of the two public ingress containers. The issuer and console keep separate HTTPS origins. Both IdP API replicas share the issuer. The console API resolves that same hostname on the Compose network for discovery and token exchange. [Portless Docker Compose commands](https://portless.sh/commands#docker-compose)

1. Run `vp install` and prepare the two API runtime environment files. Use database and SMTP addresses reachable from Docker. If you supply PostgreSQL, apply both APIs’ migrations before starting the stack.
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

4. Start the host Portless proxy. This example uses 1355 so Kiri can keep port 443. On a machine with port 443 available, use `vp exec portless proxy start --https` for port-free URLs. Trust the Portless CA in your user account when prompted.

   ```sh
   vp exec portless proxy start --https -p 1355
   vp exec portless trust
   ```

5. For the bundled local database and inbox, complete the [container setup](#optional-postgresql-and-mailbox-containers) now. Run `vp run docker:portless up -d --build` and check the routes with `vp exec portless list`.
6. Open the issuer at `https://idp.iam.localhost:1355/sign-in` and the console at `https://console.iam.localhost:1355/account`. The launcher derives the origins from the current HTTPS proxy. Use those exact origins when provisioning clients. For a fresh database, follow the operator and reserved console registration steps in the pilot guide, using `vp run docker:portless up -d` to apply environment changes. Register the console callback at `/api/v1/callback` on the console origin. [Console provisioning](pilot.md#start-the-services)

Use `vp run docker:portless ps` for service status and `vp run docker:portless down` to stop the IAM project and remove its routes. Portless keeps its shared host proxy running. The standalone pilot deployment has its own ingress settings. [Pilot deployment guide](pilot.md)

#### Optional PostgreSQL and mailbox containers

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

Set `TLS_CA_FILE="./.env.portless.d/ca.pem"`. Configure the API runtime files with `DB_HOST="database"`, `DB_PORT="5432"`, and `DB_DATABASE="iam_portless"`. Use `SMTP_HOST="mail"` and `SMTP_PORT="1025"` for the IdP. Start the dependencies with `vp run docker:portless up -d database mail`. The image creates the database on first start. Create the [database roles](pilot.md#prepare-the-issuer-and-database) as the database administrator and run each API's migrations from the host using its migrator login on `127.0.0.1:56985`. Once both schemas exist, start the full project and provision the console as described above.

## Organization administration

Apply the IdP and console migrations before deploying Phase 7. Console
sessions created before the migration need to sign in again to manage an
organization.

### Provision an operator

Use a named operator account with an independently confirmed email address.
For a new installation, export the IdP API runtime settings in a trusted
shell and run this command from the repository root.

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
