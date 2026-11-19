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
2. Apply each API's migrations in a separate shell. For each command, export
   `DB_HOST`, `DB_DATABASE`, `DB_USER`, and `DB_PASSWORD` for its migrator.
   Set `DB_PORT` and `DB_SSL` if your connection differs from the local defaults.

   | API     | Command                                 |
   | ------- | --------------------------------------- |
   | IdP     | `vp -C apps/idp/api run db:migrate`     |
   | Console | `vp -C apps/console/api run db:migrate` |

3. In each API directory, copy its `.env.example` to `.env` if needed. Fill in
   the matching runtime credentials and double-quote dotenv values. Use the
   local setup commands in shells with the runtime environment.
   [IdP example](../apps/idp/api/.env.example) · [Console example](../apps/console/api/.env.example)

Both APIs require `OIDC_ISSUER_URL`. The console API also requires
`CONSOLE_ORIGIN` and the reserved client's `OIDC_CLIENT_SECRET`. Use bare HTTPS origins, with no trailing slash. The
examples use `https://idp.localhost` and `https://console.localhost`. Use the direct HTTP ports above for smoke checks.

Each migrator owns its application schema and journal schema. The runtime
role can read and write tables in its application schema. Drizzle needs
database `CREATE` for each migrator to initialize or check the journal
schema. Runtime roles have `CONNECT` and grants on their own application data.

## IdP account flows

Serve the IdP web and API workspaces under the HTTPS origin in
`OIDC_ISSUER_URL`. Configure your reverse proxy to send `/.well-known/*` and
`/api/*` to the IdP API. Send all other paths to the IdP web server.
Preserve the public host. Redact the token in the
`/api/v1/auth/reset-password/<token>` path.
Keep query strings, request bodies, cookies, and authorization headers out
of ingress and application access logs. Verification and reset URLs carry
credentials. If the API accepts traffic exclusively from a trusted proxy that
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

Run the workspaces directly during development. The pilot phase adds
container images and ingress for the four workspaces.
[Pilot phase](plans/iam-v1-rewrite/phase-10-external-pilot.md)

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
   `/operator`. Enter the organization ID, case reference, and verified
   replacement address. Confirm the verification and send the invitation.
3. The IdP cancels outstanding owner invitations and records the operator
   ID, organization ID, case reference, timestamp, and `invited` outcome
   when it issues the replacement invitation. Reusing that case reference
   for the same organization is rejected. A later reissue requires a new
   verified case reference.
4. Have the replacement owner accept, enroll a passkey, and verify it.
   Review existing owners and remove retired accounts from the organization.
   Recovery grants ownership through invitation acceptance. It preserves
   existing owners' credentials in any other organizations they administer.
