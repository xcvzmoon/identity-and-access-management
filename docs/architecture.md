# System architecture

Nitro is the public service. Nuxt generates a client-side browser application
at build time. The API image contains the Nitro output, including the browser
assets. A reverse proxy terminates public TLS in a deployed environment.
PostgreSQL holds shared state, and the API sends account email through an
optional SMTP relay.

[Documentation index](README.md) · [Deployment](deployment.md)

```mermaid
flowchart LR
    User[User browser] --> Ingress[Canonical IAM origin and TLS ingress]
    App[Registered application backend] --> Ingress
    Ingress --> Nitro[Nitro HTTP server]
    Nitro --> UI[Static Nuxt assets]
    Nitro --> Auth[Better Auth and IAM policies]
    Auth --> DB[(PostgreSQL)]
    Auth --> Mail[SMTP relay]
    User --> App
```

## Runtime boundaries

| Boundary                       | Responsibility                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser to IAM                 | Hosted account and OIDC screens use the issuer origin. Browser writes validate their origin. Sessions travel in an HTTP-only cookie.                                    |
| Registered app to IAM          | Browser redirects initiate authorization. The app server uses its confidential client credential for token operations. Machine installation lookup has a dedicated key. |
| Ingress to Nitro               | Ingress replaces forwarding headers. Nitro trusts configured peer IPs. The public host and scheme must match the issuer settings.                                       |
| Nitro to PostgreSQL            | The runtime role uses named grants. Migration, audit access, and the alert collector run with separate privileges.                                                      |
| Nitro to SMTP                  | The relay delivers verification, recovery, and invitation messages when configured. The API owns relay credentials.                                                     |
| Registered app to its own data | The app owns its session and business records. IAM supplies the user's identity, app grant, and permission keys. The app enforces object-level access.                  |

## Request dispatch

1. Nitro serves public asset files from Nuxt's generated output. HTML files
   are excluded from the public asset mount. The generated `index.html` is
   available as a server asset for the supported page routes.
2. Browser navigation to an account or admin page receives the static shell.
   The Vue route middleware loads session state for pages marked `user` or
   `guest`. The shell contains no user data.
3. The API middleware applies no-store and origin handling to `/api` and
   child routes. It requires an IAM session for generic API routes. The auth
   gateway and hosted handlers apply their endpoint-specific authorization.
4. The auth gateway matches the HTTP method and path to an explicit allowlist.
   It normalizes request headers, applies body limits, and dispatches to
   Better Auth. Discovery uses a separate handler at the issuer root.
5. Better Auth and IAM plugins enforce credentials, sessions, client state,
   passkeys, tenant membership, and grants. Drizzle reads and writes the
   shared PostgreSQL state.

[Browser routes](browser.md) · [HTTP request rules](http-api.md#request-authorization)

## Build and process lifecycle

The build compiles shared utilities before the database package. It then
builds the full shared package, auth package, Nuxt assets, and Nitro bundle.
The Docker runtime starts the built `.output/server/index.mjs` directly.
Locally, the API's `serve` script starts Nitro from source on port 5173.
The `preview` script runs the built artifact on that port.

The Nitro startup plugin initializes the auth singleton and registers a hook
to close the database pool at shutdown. Each process creates its own lazy
pool. Replicas share the issuer settings, auth secret, and database state.
PostgreSQL backs rate counters, sessions, codes, grants, and signing keys.
An advisory lock coordinates issuer-key writes across replicas.

[Build commands](development.md) · [Configuration](http-api.md#configuration) ·
[Replica checks](pilot.md#pilot-replica-check)

## Source map

| Area                                                   | Entry points                                                                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route registration, static assets, and trusted proxies | [Nitro configuration](../apps/api/nitro.config.ts) · [Server entry](../apps/api/server/entry.ts)                                                                                 |
| HTTP authorization and dispatch                        | [API middleware](../apps/api/server/middleware/auth.ts) · [Auth gateway](../apps/api/server/api/auth/%5B...all%5D.ts) · [Request helpers](../apps/api/server/utils/auth-http.ts) |
| Hosted login and consent                               | [OIDC interaction adapter](../apps/api/server/utils/oidc-interaction.ts) · [Hosted form handler](../apps/api/server/api/oidc/%5Bstep%5D.post.ts)                                 |
| Auth policy composition and lifecycle                  | [Auth factory](../packages/auth/src/utils/auth.ts) · [Auth singleton](../packages/auth/src/utils/use-auth.ts) · [Nitro lifecycle](../apps/api/server/plugins/lifecycle.ts)       |
| Tenant permission decisions                            | [Live access queries](../packages/database/src/utils/application-access.ts) · [Access writes](../packages/database/src/utils/manage-application-access.ts)                       |
| Provisioning and packaging                             | [Build script](../scripts/build.ts) · [Dockerfile](../Dockerfile) · [Compose](../compose.yaml)                                                                                   |
