# @iam/database

PostgreSQL access through Drizzle ORM and Kit `1.0.0-rc.5-5935859`, using the
`postgres` driver. Both Drizzle versions are pinned in the database catalog.

## Local setup

From the repository root:

```sh
vp install
cp packages/database/.env.example packages/database/.env
```

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and
`DB_DATABASE` in `packages/database/.env` for your existing PostgreSQL instance.
`DB_PORT` defaults to `5432`. Set `DB_SSL="true"` if the instance
requires TLS; it defaults to `false`.

## Application use

The package exports only `schema` and `useDatabase`. Add `@iam/database` as a
workspace dependency to the consuming server package:

```ts
import { schema, useDatabase } from '@iam/database';

const database = useDatabase();
const user = await database.select().from(schema.users).limit(1);
```

`useDatabase()` initializes one pool on its first call and returns the same client
on later calls. In local mode, configuration comes from `packages/database/.env`,
with process variables taking precedence, regardless of the caller's working
directory. Testing, staging, and production use process variables only.

Connections open on the first query. Close the shared pool with
`await database.$client.end()` during application shutdown. Keep this package in
server code because it requires database credentials. SQL parameter logging is
disabled on the shared client because it handles credentials and session tokens.

## Schema and migrations

Export application tables from `src/schema/index.ts` and declare relationships
in `src/relations.ts` using the RC `defineRelations` API. Auth tables use the `iam` PostgreSQL namespace.

Derive table validators with `drizzle-orm/valibot` and application types with
Valibot `InferOutput` when adding tables. Use `database.transaction(...)` for
related writes and pass the transaction to collaborating helpers.

Run database scripts from the repository root:

```sh
vp run packages:database generate
vp run packages:database check
vp run packages:database migrate
```

Generation writes SQL and snapshots under `drizzle/`. Migration applies pending
SQL to the configured database. With the workspace's default configuration, it
creates `DB_DATABASE` on the existing PostgreSQL server if it is missing. For
that step, the configured role needs access to the `postgres` maintenance
database and the `CREATEDB` privilege. Review the SQL and confirm the target
before applying it. The `push`, `pull`, and `studio` scripts are also available;
`push` changes the database directly.

Kit configuration uses `@iam/shared/utils`'s `useEnv`. Local mode loads this package's
`.env`, with process variables taking precedence. For testing, staging, or
production, supply `APP_ENV` and the `DB_*` fields through process variables.

Drizzle RC errors can contain query parameters. Redact database errors and
telemetry at the server boundary before logging them or returning responses.

## Validation

```sh
vp check
vp test
vp run packages:database typecheck
vp run packages:database build
```

Unit tests validate configuration and lazy pool creation without connecting
to PostgreSQL. Live queries and rollback behavior require a disposable local
database and are not covered by these tests.
