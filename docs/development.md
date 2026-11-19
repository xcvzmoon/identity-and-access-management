# Workspace commands and builds

[Documentation index](README.md) · [Local setup](local.md) · [Validation](validation.md)

## Workspaces and output

| Workspace                                              | Package            | Build output     |
| ------------------------------------------------------ | ------------------ | ---------------- |
| [`apps/idp/web`](../apps/idp/web/package.json)         | `@iam/idp-web`     | Nuxt `.output/`  |
| [`apps/idp/api`](../apps/idp/api/package.json)         | `@iam/idp-api`     | Nitro `.output/` |
| [`apps/console/web`](../apps/console/web/package.json) | `@iam/console-web` | Nuxt `.output/`  |
| [`apps/console/api`](../apps/console/api/package.json) | `@iam/console-api` | Nitro `.output/` |

The root manifest pins Node and pnpm. The workspace catalogs pin shared dependency versions. Build output stays in the workspace that produced it.
[Root scripts](../package.json) · [Workspace catalog](../pnpm-workspace.yaml)

Each API requires a valid `.env` in its own workspace for `dev` and `build`.
Copy the API's `.env.example` and fill in the required values. At startup,
the lifecycle plugin validates the runtime environment and then checks the
PostgreSQL connection. Nitro holds requests during initialization and
returns HTTP 500 if a startup check fails.
[Local setup](local.md#database-setup)

## Commands

Run workspace commands from the repository root.

| Command                                | Behavior                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `vp install`                           | Install dependencies and prepare the Nuxt workspaces.                                                     |
| `vp run build`                         | Build all four workspaces.                                                                                |
| `vp -C apps/idp/web run build`         | Build one workspace. Substitute its path for another workspace.                                           |
| `vp -C apps/idp/api run dev`           | Start one workspace in development. Use the same form for its `preview` script after building.            |
| `vp check`                             | Run the Vite+ format, lint, and type-aware checks.                                                        |
| `vp run typecheck`                     | Run the root and workspace TypeScript checks.                                                             |
| `vp run docker:portless up -d --build` | Build and run the Compose stack behind Portless. See the [Portless setup](local.md#docker-with-portless). |
| `vp test --run`                        | Run the root test suite once.                                                                             |
| `vp -C apps/idp/api run db:check`      | Check one API's migration history.                                                                        |

Each API keeps its migration history in its own `migrations/` directory.
Export the required `DB_*` settings before running any Drizzle script.
Use the matching migrator credentials for `db:migrate`.
[Database setup](local.md#database-setup)

For IdP auth schema changes, export the IdP runtime settings and run the
Better Auth CLI from `apps/idp/api`. Use the CLI version matching the
installed `better-auth` package.

```sh
pnpm dlx auth@1.7.26 generate --config ./auth.config.ts --output /tmp/iam-auth-schema.ts
```

Apply the generated fields and relations under `server/database/` using
the existing UUID and timestamp helpers. Run `vp run db:generate` from the
same workspace to generate the SQL migration and snapshot.

## Repository conventions

`AGENTS.md` defines project conventions, including dotenv quoting, TypeScript
naming, validation, and directive comments. Vite+ configures Oxfmt, Oxlint,
and Vitest. The pre-commit hook runs staged formatting and lint checks.
[Project conventions](../AGENTS.md) · [Vite+ configuration](../vite.config.ts)

## API logs

The IdP and console APIs emit one evlog JSON event per response to the process log streams. Filter by `event="api-request"` and `service="iam-idp-api"` or `service="iam-console-api"`. Each event includes a generated request ID, HTTP method, route template, response status, and duration in milliseconds. The IdP adds the validated action for organization management. Requests without a matched route use `unmatched`.

Use the HTTP status and route to investigate a failure. Request events omit raw URLs, query strings, headers, bodies, user identifiers, and exception details. The IdP emits separate events for signing-key transitions and email delivery failures. PostgreSQL remains the source for authorization and owner-recovery audit records. [Log verification](validation.md#audit-access-and-retention) · [Audit retention](local.md#audit-retention)
