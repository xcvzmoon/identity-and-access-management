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

Build the package with `vp run packages:database build`. Add `@iam/database`
as a workspace dependency to the consuming server package, then create one
client using the database environment utility:

```ts
import { createDatabase, useDatabaseEnv } from '@iam/database';

const config = useDatabaseEnv({ workspacePath: 'apps/api' });
const database = createDatabase(config);
```

Reuse this client across requests. Connections open on the first query.
Close them with `await database.$client.end()` in the server shutdown lifecycle.
Keep this package in server code because it requires database credentials.
The [Postgres.js documentation](https://github.com/porsager/postgres#connection)
describes connection pooling and shutdown.

`useDatabaseEnv` calls the shared `useEnv` loader and validates the connection
fields. Pass the consuming server's workspace path in local mode so it loads
that workspace's `.env`. Kit passes the database package's directory and loads
`packages/database/.env` in local mode. The utility returns `host`, `port`, `user`,
`password`, `database`, `ssl`, and `logger` for `createDatabase`.

Set `DB_LOGGER="true"` to use `drizzle-query-logger`.
It defaults to `false`, which disables query logging. Callers can also override
the setting explicitly:

```ts
const database = createDatabase({ ...config, logger: true });
```

The logger includes query parameters in its output. Enable it only where those
values may be logged. Version `1.1.3` declares an ORM peer range that excludes
the pinned RC; its `Logger` interface and enabled/disabled wiring are checked
by this package's typecheck and tests.

## Schema and migrations

Export application tables from `src/schema/index.ts` and declare relationships
in `src/relations.ts` using the RC `defineRelations` API. The schema starts
empty; add application tables before generating the first migration.

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
SQL to the configured database. Review the SQL and confirm the target before
applying it. The `push`, `pull`, and `studio` scripts are also available; `push`
changes the database directly.

Kit configuration uses `@iam/shared`'s `useEnv`. Local mode loads this package's
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
