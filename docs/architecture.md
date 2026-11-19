# IAM architecture

## Workspace ownership

| Workspace                                    | Framework | Owns                                                                                                              |
| -------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| [IdP web](../apps/idp/web/README.md)         | Nuxt      | Hosted sign-in, invitation signup, recovery, consent, passkey and operator pages                                  |
| [IdP API](../apps/idp/api)                   | Nitro     | Better Auth, OIDC endpoints, identity and SSO, organizations, installation grants, signing keys, and audit events |
| [Console web](../apps/console/web/README.md) | Nuxt      | Account and organization management pages                                                                         |
| [Console API](../apps/console/api)           | Nitro     | Console OIDC client, callback, application sessions, and IdP management requests                                  |

The Nuxt apps maintain their own pages, modules, and styles. The APIs keep method-specific handlers under `server/api/` or `server/routes/`. Services implement policy, repositories perform database operations, and each API owns its schema and migrations. Build and package names are listed in the workspace reference. [Workspace reference](development.md)

## Origins and routing

Every deployment has one canonical HTTPS issuer shared by its organizations. Issuer ingress sends `/api/*` and `/.well-known/*` to the IdP API and page requests to IdP web. The console has a separate HTTPS origin. Its ingress sends `/api/*`, including `/api/v1/callback`, to the console API and page requests to console web.

Caddy distributes issuer API requests across two replicas in the packaged deployment. Both share PostgreSQL state, a Better Auth secret, and the canonical issuer URL. In local development, Portless gives each public hostname a stable route and terminates host HTTPS. Caddy also serves the canonical issuer over TLS inside the Compose network, where the console backend reaches it for discovery and token exchange. [Local setup](local.md) · [Pilot deployment](pilot.md)

## Storage boundaries

The IdP is authoritative for accounts, SSO sessions, membership, grants, and signing keys. The console stores its own application sessions and retains an encrypted access token for management requests. Each API has its own PostgreSQL schema, migration journal, migrator, and restricted runtime login. The IdP runtime appends audit events. Dedicated database roles read them or run retention. [Database setup](local.md#database-setup) · [Audit retention](local.md#audit-retention)

## Sign-in and authorization

The console and customer app backends run Authorization Code with S256 PKCE. Better Auth serves the OIDC endpoints. IAM checks invitation eligibility and installation grants, and prompts for customer-app consent when the approved grant changes. The IdP can reuse its SSO session. Each client validates the callback and ID token before starting its own session.

Each customer app installation has a distinct OAuth client. The backend introspects the user's access token for every protected request and checks permissions and resource ownership. Grant revocation or IAM sign-out affects the next live check. The backend withholds protected resources if introspection fails. App sign-out clears the app's own session.

For organization management, the console API forwards requests on the user's behalf. The IdP checks live console authorization, target organization membership, role, and session-bound passkey verification. [Client integration](client-integration.md)
