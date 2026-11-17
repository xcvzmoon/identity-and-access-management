# Identity and Access Management

`@iam/auth` owns Better Auth configuration and exposes the shared `useAuth()`
server. The Nitro API mounts its endpoints and enforces sessions in middleware.
The Nuxt web app uses `better-auth/vue` for browser auth requests to the API.
Its auth plugin uses Better Auth's documented `useSession(useFetch)` integration
for SSR and hydration. Session reads use the same `useApi` composable as other
web API reads. Its API client forwards renewed cookies to the page response,
and Nuxt hydrates only the shared user's ID, name, and email. Nuxt does not host Better Auth or
access PostgreSQL.

## Local setup

Run `vp install`, then `vp run build` to build the workspace packages and apps.
Copy these example files to `.env` in the same directories:

- `packages/auth/.env.example`
- `apps/web/.env.example`
- `packages/database/.env.example`

Set the database connection fields only in `packages/database/.env`. The API
gets the shared client through `useDatabase()`; it does not load database
credentials from its own workspace.

Set auth configuration in `packages/auth/.env`. Generate `AUTH_SECRET` with
`openssl rand -base64 32`. Keep it stable across API restarts and replicas. The
web app does not need this secret. All dotenv values must be quoted.

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
(`http://localhost:3000` locally). Browser authentication calls that API directly;
the web app on port 5173 performs session reads directly from the API during SSR.
Nuxt has no local authentication endpoints.

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
