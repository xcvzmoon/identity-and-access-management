# @iam/auth

The server package exports `useAuth()`, which initializes Better Auth once and
returns the same instance on subsequent calls. It uses the shared database from
`@iam/database`, the `iam` schema, and the Relations v2 Drizzle adapter.

```ts
import { useAuth } from '@iam/auth';

const auth = useAuth();
const session = await auth.api.getSession({ headers: request.headers });
```

In local mode, configure `packages/auth/.env` using `.env.example`. Database
credentials belong in `packages/database/.env`. Testing, staging, and production
read process variables. Generate `AUTH_SECRET` with `openssl rand -base64 32` and
keep it stable across restarts and API replicas. `AUTH_URL` and `AUTH_WEB_ORIGIN`
identify the API and web respectively. Both are HTTP origins without paths or trailing slashes; use HTTPS in production.

The API is the only auth server. Nuxt uses the API for browser authentication
and reads its sessions during SSR. Nuxt has no database connection or auth secret.

The API checks configuration on startup and closes the shared database pool at
shutdown. Its middleware protects `/api/**` while allowing `/api/auth/**` through
to Better Auth. Authenticated API writes also require a trusted Origin header.
Session checks must be enforced by the consuming server; importing
this package alone does not protect routes.

## Validation

```sh
vp check
vp test
vp run typecheck
vp run build
```

API integration tests use a migrated, disposable local PostgreSQL database when
`AUTH_TEST_DB_PORT` is set. See the root README for connection requirements.
