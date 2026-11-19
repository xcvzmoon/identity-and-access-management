# IAM v1 architecture

[Documentation index](README.md) · [Launch scope](rewrite-scope.md) · [Implementation plan](plans/iam-v1-rewrite/overview.md)

## Target monorepo structure

The IdP and console each have a Nuxt frontend and a Nitro API. The four
workspaces already exist. Build the rewrite inside them using each
workspace's existing framework configuration.

```text
.
├── apps/
│   ├── idp/
│   │   ├── web/
│   │   │   ├── app/
│   │   │   ├── golar.config.ts
│   │   │   ├── nuxt.config.ts
│   │   │   └── package.json
│   │   └── api/
│   │       ├── server/
│   │       │   ├── api/
│   │       │   └── database/
│   │       │       ├── index.ts
│   │       │       ├── relations.ts
│   │       │       └── schema/
│   │       ├── drizzle.config.ts
│   │       ├── nitro.config.ts
│   │       └── package.json
│   └── console/
│       ├── web/
│       │   ├── app/
│       │   ├── golar.config.ts
│       │   ├── nuxt.config.ts
│       │   └── package.json
│       └── api/
│           ├── server/
│           │   ├── api/
│           │   └── database/
│           │       ├── index.ts
│           │       ├── relations.ts
│           │       └── schema/
│           ├── drizzle.config.ts
│           ├── nitro.config.ts
│           └── package.json
├── docs/
├── evaluations/
│   └── better-auth/
├── scripts/
├── tools/
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── vite.config.ts
```

| Workspace                                 | V1 ownership                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/idp/web`](../apps/idp/web)         | Hosted sign-in, invitation signup, password recovery, consent, and passkey prompts                                                      |
| [`apps/idp/api`](../apps/idp/api)         | Better Auth, OIDC endpoints, IAM accounts and SSO sessions, organizations, app registrations and grants, signing keys, and audit events |
| [`apps/console/web`](../apps/console/web) | Account and organization pages, application administration, and sign-in redirects through the console API                               |
| [`apps/console/api`](../apps/console/api) | Console OIDC client, callback and application session, and calls to the IdP management interface on the user's behalf                   |

Each Nuxt app keeps its own modules, app config, and styles. The target uses
standalone Nuxt apps without a Nuxt layer. The workspace catalog provides
shared dependency versions. Product code and runtime configuration live in
the four app workspaces. The Better Auth evaluation has its own lockfile and
runs independently of the product builds.
[Workspace manifest](../pnpm-workspace.yaml) · [Evaluation fixture](../evaluations/better-auth)

Add pages to each web workspace under `app/pages/` as its flows are built.
Add HTTP handlers under the owning API's `server/api/` or `server/routes/`,
according to the public URL. Keep schema definitions and migration history
with that API's database code.

To list the workspace files as tracked in Git, run `git ls-files apps`.
The [workspace reference](development.md) lists package names and commands.

## Deployment and data boundaries

One public HTTPS issuer URL identifies the IdP for the deployment. At that
origin, ingress routes hosted pages to IdP web and issuer endpoints to IdP
API. The console has its own origin, with pages served by console web and
the OIDC callback and session endpoints served by console API. The local dev
ports are direct entry points for the scaffolds.
[Local setup](local.md) · [External pilot phase](plans/iam-v1-rewrite/phase-10-external-pilot.md)

Each API owns its PostgreSQL schema, migrations, and database credentials.
The IdP is the source of truth for identity, tenant data, and customer app
authorization. The console owns its application sessions. For organization
operations, console API calls the IdP management interface and the IdP
checks the user's membership, role, and recent passkey verification where
required. The fresh database and isolation checks are part of Phase 2.
[Database ownership phase](plans/iam-v1-rewrite/phase-02-establish-apps-and-storage.md)

## Sign-in and access

The console and customer app backends redirect users to the IdP using
Authorization Code with S256 PKCE. Better Auth runs the OIDC endpoints.
IAM checks invitation eligibility, installation grants, and consent.
The IdP can reuse the current SSO session. Each client validates the
callback and ID token and starts its own application session.
[Issuer phase](plans/iam-v1-rewrite/phase-04-oidc-issuer-and-app-grants.md)

Each customer installation has its own OAuth client. On every protected
request, the app backend checks current access with the IdP and enforces
its own resource permissions. When the grant is revoked, IAM sign-out ends
the token's SSO session, or the check is unavailable, the app denies access.
App sign-out ends the local application session.
[Live access decision](adr/0004-check-app-grants-live.md) · [Per-installation clients](adr/0005-register-one-client-per-installation.md)
