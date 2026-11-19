# Run the IAM workspaces locally

[Documentation index](README.md) · [Workspace reference](development.md)

## Local setup

Install Vite+ and run `vp install` from the repository root. Start each
workspace you need in its own terminal. Set up PostgreSQL before starting
the APIs. The web workspaces can start on their own.
[Database setup](#database-setup)

| Workspace   | Command                          | Local address                      |
| ----------- | -------------------------------- | ---------------------------------- |
| IdP web     | `vp -C apps/idp/web run dev`     | `http://localhost:3000` by default |
| IdP API     | `vp -C apps/idp/api run dev`     | `http://localhost:65430/api/hello` |
| Console web | `vp -C apps/console/web run dev` | `http://localhost:3001`            |
| Console API | `vp -C apps/console/api run dev` | `http://localhost:65431/api/hello` |

Use the port printed by the dev server if the default is busy. The web
workspaces serve their scaffold pages. Both API examples return
`{"message":"Hello from Nitro!"}`. These entry points are for checking the
workspaces. The public issuer and sign-in flows are part of the rewrite.

## Database setup

1. Create a fresh PostgreSQL database with `createdb iam_v1`.
2. Apply each API's migrations in a separate shell. For each command, export
   `DB_HOST`, `DB_DATABASE`, `DB_USER`, and `DB_PASSWORD` for its migrator.
   Set `DB_PORT` and `DB_SSL` if your connection differs from the local defaults.

   | API     | Command                                 |
   | ------- | --------------------------------------- |
   | IdP     | `vp -C apps/idp/api run db:migrate`     |
   | Console | `vp -C apps/console/api run db:migrate` |

3. In each API directory, copy its `.env.example` to `.env` if needed. Fill in
   the matching runtime credentials and double-quote dotenv values. Use the
   local setup commands in shells with the runtime environment.
   [IdP example](../apps/idp/api/.env.example) · [Console example](../apps/console/api/.env.example)

Both APIs require `OIDC_ISSUER_URL`. The console API also requires
`CONSOLE_ORIGIN`. Use bare HTTPS origins, with no trailing slash. The
examples reserve `https://idp.localhost` and `https://console.localhost` for
future integration flows. Use the direct HTTP ports above for smoke checks.

Each migrator owns its application schema and journal schema. The runtime
role can read and write tables in its application schema. Drizzle needs
database `CREATE` for each migrator to initialize or check the journal
schema. Runtime roles have `CONNECT` and grants on their own application data.

## Containers

Run the workspaces directly during development. The pilot phase adds
container images and ingress for the four workspaces.
[Pilot phase](plans/iam-v1-rewrite/phase-10-external-pilot.md)
