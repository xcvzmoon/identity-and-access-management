# Workspace and build reference

[Documentation index](README.md) · [Local setup](local.md) · [Validation](validation.md)

## Workspaces and output

| Workspace                                              | Package            | Build output     |
| ------------------------------------------------------ | ------------------ | ---------------- |
| [`apps/idp/web`](../apps/idp/web/package.json)         | `@iam/idp-web`     | Nuxt `.output/`  |
| [`apps/idp/api`](../apps/idp/api/package.json)         | `@iam/idp-api`     | Nitro `.output/` |
| [`apps/console/web`](../apps/console/web/package.json) | `@iam/console-web` | Nuxt `.output/`  |
| [`apps/console/api`](../apps/console/api/package.json) | `@iam/console-api` | Nitro `.output/` |

The root pins Node and pnpm in `package.json`. The workspace catalogs pin
dependencies shared by each workspace type. The root build script selects
all four workspaces. Each build writes its output inside its workspace.
[Root scripts](../package.json) · [Workspace catalog](../pnpm-workspace.yaml)

Each API requires a valid `.env` in its own workspace for `dev` and `build`.
Copy the API's `.env.example` and fill in the required values. At startup,
the lifecycle plugin validates the runtime environment and then checks the
PostgreSQL connection. Nitro holds requests during initialization and
returns HTTP 500 if a startup check fails.
[Local setup](local.md#database-setup)

## Commands

Run workspace commands from the repository root.

| Command                           | Behavior                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `vp install`                      | Install dependencies and prepare the Nuxt workspaces.                                          |
| `vp run build`                    | Build all four workspaces.                                                                     |
| `vp -C apps/idp/web run build`    | Build one workspace. Substitute its path for another workspace.                                |
| `vp -C apps/idp/api run dev`      | Start one workspace in development. Use the same form for its `preview` script after building. |
| `vp check`                        | Run the Vite+ format, lint, and type-aware checks.                                             |
| `vp run typecheck`                | Run the root and workspace TypeScript checks.                                                  |
| `vp test --run`                   | Run the root test suite once.                                                                  |
| `vp -C apps/idp/api run db:check` | Check one API's migration history.                                                             |

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

## Code conventions and tooling

`AGENTS.md` defines project conventions, including dotenv quoting, TypeScript
naming, validation, and directive comments. Vite+ configures Oxfmt, Oxlint,
and Vitest. The pre-commit hook runs staged formatting and lint checks.
[Project conventions](../AGENTS.md) · [Vite+ configuration](../vite.config.ts)
