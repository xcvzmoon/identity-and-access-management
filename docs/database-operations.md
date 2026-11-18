# Migrate and recover PostgreSQL

[Documentation index](README.md)

## Schema and migrations

Export schema tables from [src/schema/index.ts](../packages/database/src/schema/index.ts) and add
relations to [src/relations.ts](../packages/database/src/relations.ts). The auth definitions were
adapted from the Better Auth 1.7.25 schema. Use the shared Valibot contracts
when a consumer needs portable schemas derived from these tables.

Use the root alias to run the migration workflow.

```sh
vp run packages:database generate --output json
vp run packages:database check
vp run packages:database migrate
```

1. `generate` writes a new SQL migration and snapshot under `drizzle/`.
   Review the generated SQL and commit the matching snapshot.
2. `check` validates migration history and snapshot consistency.
3. `migrate` applies pending SQL and records it in the separate `drizzle`
   schema. Apply it before starting the API against the new schema.

With the default workspace configuration, `migrate` checks `DB_DATABASE`
before invoking Drizzle Kit. If PostgreSQL reports that it is missing, the
wrapper connects to the `postgres` maintenance database on the same server
and creates the configured database. The creation step needs `CREATEDB` and
access to `postgres`. The role applying the SQL also needs permission to
create or alter the affected objects. The API runtime needs access to the
resulting `iam` schema and tables.

The initial migration creates the `iam` schema and core auth tables. An
existing database with earlier, untracked auth tables needs a reconciliation
migration that preserves its SQL and migration history.

The workspace also exposes `vp run packages:database push` for applying schema
changes directly, `vp run packages:database pull` for introspection, and
`vp run packages:database studio` for inspection. Use the migration workflow
for tracked releases. Keep database errors inside the server boundary and
redact details that can contain SQL parameters.

## Deployment roles

Provision the database with a migration owner and a dedicated API runtime
login. The migration owner owns the database and the objects created by the
migrations. The runtime login needs no ownership, role memberships, superuser,
`CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`. Use a fresh runtime
login and check privileges inherited from `PUBLIC` on existing databases,
including whether `PUBLIC` can create objects in the `public` schema.

1. Set `DB_USER` and `DB_PASSWORD` to the migration credentials in the migration
   job. Run `vp run packages:database migrate` against the provisioned database.
2. As the migration owner, apply the grants with `psql` from the repository
   root. Set `PGHOST`, `PGPORT`, `PGDATABASE`, and `PGUSER` for the target
   database and use migration credentials from your secret store.

   ```sh
   psql -X --set=ON_ERROR_STOP=1 --set=runtime_role=iam_runtime \
     --file=packages/database/scripts/runtime-privileges.sql
   ```

3. Set the API's `DB_USER` and `DB_PASSWORD` to the runtime credentials.
   Deploy or restart all API replicas, then verify sign-in and the OIDC flow.
   Keep the migration credentials in the migration job.

The grants cover named tables in the `iam` schema. The runtime can insert
application access events, while reading or modifying stored events requires
a separate role. The `drizzle` migration history is accessible to the migration
owner. Review the script whenever a release adds tables or changes how the API
uses them. Applying it again adds the listed grants. Any broader privileges
from an earlier configuration must be removed separately.

Connect as the runtime login and check the effective grants before deploying.
The first column should be true and the others should be false.

```sql
SELECT has_table_privilege(current_user, 'iam.app_access_events', 'INSERT') AS audit_insert,
       has_table_privilege(current_user, 'iam.app_access_events', 'SELECT,UPDATE,DELETE,TRUNCATE') AS audit_access,
       has_schema_privilege(current_user, 'iam', 'CREATE') AS iam_create,
       has_schema_privilege(current_user, 'drizzle', 'USAGE') AS migration_history;
```

## Backup and restore

Use the database provider's encrypted backups and point-in-time recovery for
production. Set retention to cover the recovery window and record the maximum
acceptable data loss and recovery time before the pilot. Limit backup access
to recovery operators. IAM backups contain account data, password hashes,
session records, application credentials, signing key material, and audit
events. Keep the API and web secrets in the secret store and record which
versions match the database and application release.

Use a custom-format PostgreSQL archive to rehearse a logical restore. On a
restricted host, set the PostgreSQL client connection variables for the
source and authenticate as the migration owner. Use a private directory on
encrypted storage for the archive and verify the database server's identity
when connecting over the network. Include the full IAM database so the
`iam` schema and `drizzle` migration history recover together.
[PostgreSQL backup documentation](https://www.postgresql.org/docs/current/backup.html)

```sh
umask 077
pg_dump --format=custom --file=iam.dump
```

Provision a new, empty target database with a migration owner and a dedicated
runtime login. Keep the target off public ingress and block outbound email
during the rehearsal. Point the PostgreSQL client at the new database
and restore as its migration owner. Reapply the API grants from the release
being deployed. [PostgreSQL restore documentation](https://www.postgresql.org/docs/current/app-pgrestore.html)

```sh
pg_restore --single-transaction --exit-on-error --no-owner --no-privileges \
  --dbname="$PGDATABASE" iam.dump
psql -X --set=ON_ERROR_STOP=1 --set=runtime_role=iam_runtime \
  --file=packages/database/scripts/runtime-privileges.sql
```

Verify both schemas are present and run the [runtime privilege check](#deployment-roles).
Start the matching IAM release against the isolated target with the runtime
login and the corresponding secrets. Check discovery and confirm JWKS
publishes the expected signing keys. Sign in with a test account, complete a
test application's OIDC callback, and check both an authorized and a denied
permission. Record the recovery point and elapsed time. Delete temporary
archive copies and the isolated database under the recovery environment's
retention policy.

Before an incident cutover, reconcile changes made after the recovery point.
A restore can resurrect revoked sessions, tokens, credentials and grants or
bring back deleted personal data. Keep client traffic blocked until those
changes have been reapplied or the affected access has been disabled. If the
incident involved credential or signing key exposure, rotate the affected
secrets and apply containment before reopening traffic.
