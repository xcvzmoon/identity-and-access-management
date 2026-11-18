# Workspace and build reference

[Documentation index](README.md) · [Local setup](local.md) · [Validation](validation.md)

## Workspaces and output

| Workspace                                             | Sources and responsibility                                                           | Output                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [`apps/api`](../apps/api/README.md)                   | Nitro HTTP pipeline, hosted-auth routes, discovery, static shell, and lifecycle      | `.output/server/index.mjs` and packaged browser assets |
| [`apps/web`](../apps/web/README.md)                   | Nuxt pages, Vue components, session state, OIDC example, and ingress examples        | `.output/public` from `nuxt generate`                  |
| [`packages/auth`](../packages/auth/README.md)         | Better Auth composition, account and organization policies, OIDC, and key management | `dist/index.mjs`                                       |
| [`packages/database`](../packages/database/README.md) | Drizzle schema, PostgreSQL queries, database migrations, and operator SQL            | `dist/index.mjs` and `dist/schema.mjs`                 |
| [`packages/shared`](../packages/shared/README.md)     | Valibot row contracts and environment utilities                                      | `dist/types.mjs` and `dist/utils.mjs`                  |

The root pins Node and pnpm in `package.json`. Dependency versions live in the
workspace catalogs and lockfile. The root build first emits shared utilities
because database initialization imports them. It then builds the database
package, full shared package, auth package, web, and API. The API build
consumes the generated browser files.

[Root scripts](../package.json) · [Version catalog](../pnpm-workspace.yaml) ·
[Build order](../scripts/build.ts)

## Commands

Run these commands from the repository root.

| Command                                           | Behavior                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp install`                                      | Install dependencies and initialize the Vite+ workspace.                                                                                                              |
| `vp run build`                                    | Build the workspaces in dependency order.                                                                                                                             |
| `vp run create-env`                               | Create local dotenv files for auth and database. Existing files are preserved by default.                                                                             |
| `vp run apps:api dev`                             | Start the Nitro development server on port 5173. Generate the web assets first.                                                                                       |
| `vp run apps:api serve`                           | Start Nitro from source on port 5173.                                                                                                                                 |
| `vp run apps:api preview`                         | Start the built Nitro service on port 5173.                                                                                                                           |
| `vp run apps:api fetch` or `vp run apps:api curl` | Invoke the corresponding Nitro CLI command with supplied arguments.                                                                                                   |
| `vp run apps:web build`                           | Generate the Nuxt assets. Rebuild Nitro to update the packaged UI.                                                                                                    |
| `vp check`                                        | Run the Vite+ workspace checks.                                                                                                                                       |
| `vp run typecheck`                                | Run the root TypeScript check, then each workspace's typecheck script.                                                                                                |
| `vp test --run`                                   | Run the default test suite once. Integration tests use the documented fixture settings.                                                                               |
| `vp run test:watch` or `vp run test:verbose`      | Run the Vite+ test runner in watch mode or with verbose output.                                                                                                       |
| `vp run docker up`                                | Build and start the Compose service. The wrapper also exposes `build`, `down`, `start`, `stop`, `restart`, `logs`, and `ps`.                                          |
| `vp run refresh`                                  | Remove workspace dependency installs and the lockfile, regenerate them, clean Nuxt, then build and validate. Use it when you intend to refresh dependency resolution. |
| `vp run release`                                  | Run genbumppush. The repository config defaults to a patch release with GitHub releases enabled.                                                                      |

[Environment generator](../scripts/create-env.ts) ·
[Container wrapper](../scripts/docker.ts) ·
[Typecheck script](../scripts/typecheck.ts) ·
[Release configuration](../genbumppush.config.ts)

## Code conventions and tooling

`AGENTS.md` defines project conventions, including dotenv quoting,
TypeScript naming, validation, and directive comments. Vite+ configures
Oxfmt, Oxlint, and Vitest. The pre-commit hook runs staged formatting and
lint checks. The pre-push hook selects checks based on the changed file types.

Local lint rules enforce inline statement spacing, multiline object
properties, named Vue props types, a props variable, and type imports before
value imports. The vendored rule set adds constraints on casts, type
widening, collection transformations, and readable spacing. Update the
configured rule or source code when conventions change. Vendored skill
files and lint rule sources have their own scope in the root configuration.

[Project conventions](../AGENTS.md) · [Vite+ configuration](../vite.config.ts) ·
[Repository rules](../tools/oxlint/custom/index.ts) ·
[Vendored rules](../tools/oxlint/anti-slop/UPSTREAM.md)
