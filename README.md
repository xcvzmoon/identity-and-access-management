# Identity and Access Management

`@iam/auth` owns Better Auth configuration and exposes the shared `useAuth()`
server. The Nitro API mounts its endpoints and enforces sessions in middleware.
Nuxt forwards sign-in, sign-up, and sign-out requests to Better Auth and updates
the web session in the same response.
Nuxt Auth Utils provides the web session. Nuxt verifies the Better Auth session
before rendering or refreshing the web session, forwards renewed API cookies,
and seals only the user's ID, name, and email. Better Auth remains responsible
for credentials and session revocation.

## Local setup

Run `vp install`, then `vp run build` to build the workspace packages and apps.
Run `vp run create-env` to create local `.env` files from these examples:

- `packages/auth/.env.example`
- `apps/web/.env.example`
- `packages/database/.env.example`

The script uses `openssl rand -base64 32` to generate separate values for
`AUTH_SECRET` and `NUXT_APP_SECRET` when it creates their files. It keeps any
existing configured `.env` files. Keep each secret stable across restarts and replicas.

In a terminal, `vp run create-env` asks for your local PostgreSQL connection
details when `packages/database/.env` is missing or still matches the example.
It hides the password as you type. Noninteractive runs copy the database
example, and a later interactive run can fill it in. Quote any manually edited
dotenv values with double quotes.

Run `vp run create-env --force` to recreate the files from the examples. This
generates new auth and web secrets and prompts again for PostgreSQL settings in
a terminal. A noninteractive forced run replaces the database settings with
the example values. Restarting the apps with new secrets invalidates existing
sessions.

Run the migration against your development database:

```sh
vp -C packages/database run migrate
```

Start each app in its own terminal:

```sh
vp -C apps/api run dev
vp -C apps/web run dev
```

Open `http://localhost:5173/signup`. The API listens on port 3000. The web app
lets users sign up, sign in, view their account, and sign out. Passwords must
contain 12 to 128 characters. API middleware requires a valid session outside the
authentication endpoints.

## Deployment

Set `APP_ENV="production"` and the server's `AUTH_SECRET`, `AUTH_URL`,
`AUTH_WEB_ORIGIN`, and `DB_*` environment variables. `AUTH_URL` is the public API
origin; `AUTH_WEB_ORIGIN` is the public web origin. Use HTTPS in production.
Auth logs omit query parameters and error objects. Protected API routes return
503 when session storage is unavailable.

Set `NUXT_PUBLIC_API_URL` to the browser-accessible API origin
(`http://localhost:3000` locally). Sign-in, sign-up, and sign-out go through Nuxt.
During SSR, Nuxt Auth Utils reads its sealed session and checks it with the API.
Set `NUXT_APP_SECRET` to seal web sessions in production. Use
`NUXT_SESSION_COOKIE_SECURE="false"` only when testing a production build over
local HTTP.

For SSR, the browser must send the session cookie to both the web and API hosts.
Localhost ports 3000 and 5173 share a cookie host. Deployments on different
subdomains require a deliberately shared cookie domain in the API auth settings;
otherwise the API's host-only cookie cannot reach the web server for SSR. Both
hosts must use HTTPS in production. The API ingress must supply trustworthy
client IP headers for rate limiting.
Apply migrations before starting the new API. Start each built app from its own
workspace directory with `node .output/server/index.mjs`.

Session cookies are HttpOnly and SameSite=Lax, with Secure enabled for HTTPS.
Rate limits are stored in PostgreSQL and survive API restarts. Email verification,
password recovery, and OAuth providers are not configured; they require a mail
service or provider credentials.

## Authentication schema

Auth tables live in PostgreSQL's `iam` schema. `generateUuid()` supplies UUIDv7
IDs through Drizzle; raw SQL inserts must supply their own IDs. Better Auth leaves
ID generation to Drizzle. `generateTimestamps()` supplies the standard audit
timestamps, and expiry fields use `TIMESTAMP_CONFIG`. The migration
role must be able to create schemas and tables. Apply migrations before deploying
the API; the runtime role needs access to `iam` and its tables. The migration
runner tracks migrations in its separate `drizzle` schema.

The tables and Relations v2 definitions originated from `auth@1.7.25` and were
adapted to the database package's helpers. Tables live in
`packages/database/src/schema/auth.ts`; relations live in
`packages/database/src/relations.ts`. Rebuild the database package after changes.

Generate and review the migration with:

```sh
vp -C packages/database run generate --output json
```

This initial migration replaces the uncommitted migration from the authentication
setup. It is for a database where that earlier migration has not been applied.
Recreate disposable development databases that used it. An existing shared
database needs a separate migration that preserves its data and migration history.

## Validation

```sh
vp check
vp test
vp run typecheck
vp run build
```

The PostgreSQL integration suite runs only when `AUTH_TEST_DB_PORT` is set. Use a
migrated, disposable PostgreSQL database named `iam`, owned by `iam`, listening on
`127.0.0.1` at that port. The test connection uses password `disposable` (or local
trust authentication). It creates and deletes test identities and rate-limit
records, so never point it at a shared database.

```sh
AUTH_TEST_DB_PORT=55439 vp test apps/api/tests/auth.integration.test.ts
```

It covers registration, hashed credentials, session reads and revocation,
sign-in, invalid credentials, untrusted origins, database rate limits, generated
relations.

API middleware protects `/api/**` by default. Only `/api/auth` and its child paths
are public within that prefix. Authenticated writes must include a trusted Origin
header. Middleware validates the session once per request and forwards renewed session
cookies. Missing or revoked sessions return 401; auth
storage failures return 503. Routes outside `/api` are unaffected.

The SSR integration tests also require built web and API servers running on ports
5173 and 3000 against that disposable database. They verify personalized HTML,
server redirects, cookie renewal, token omission from the payload, and revocation:

```sh
AUTH_TEST_DB_PORT=55439 AUTH_SSR_TEST_URL=http://localhost:5173 vp test apps/web/tests/ssr.integration.test.ts
```
