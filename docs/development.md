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
| `vp -C apps/idp/api run db:check` | Check migration history in one API once the Phase 2 baseline exists.                           |

Both API manifests define Drizzle scripts. Phase 2 establishes the database
roles and migration baseline. The root `create-env` helper still searches the
old one-level workspace layout. Use the per-API examples for local settings.
The current Dockerfile and Compose setup still target POC paths. Replacement
packaging is part of the pilot plan.
[Database phase](plans/iam-v1-rewrite/phase-02-establish-apps-and-storage.md) · [Pilot phase](plans/iam-v1-rewrite/phase-10-external-pilot.md)

## Code conventions and tooling

`AGENTS.md` defines project conventions, including dotenv quoting, TypeScript
naming, validation, and directive comments. Vite+ configures Oxfmt, Oxlint,
and Vitest. The pre-commit hook runs staged formatting and lint checks.
[Project conventions](../AGENTS.md) · [Vite+ configuration](../vite.config.ts)
