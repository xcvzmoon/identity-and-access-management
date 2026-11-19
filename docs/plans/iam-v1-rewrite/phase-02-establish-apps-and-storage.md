# Phase 2. Verify the workspaces and establish database ownership

[Implementation plan](overview.md) · [Target monorepo structure](../../architecture.md#target-monorepo-structure)

## Outcome

The IdP and console use separate application schemas, migration journals,
and database roles in a fresh PostgreSQL database. Both APIs validate
their settings and connect to PostgreSQL during startup.
[Local setup](../../local.md)

## Changes

- Establish a fresh PostgreSQL database with an IdP schema and a console
  schema. Give each API separate migration and runtime credentials.
  Keep each migration history in its API workspace and configure a
  separate database migration journal for each.
- Keep database definitions under each API's `server/database/`. Use the
  existing Drizzle configuration and relation definitions compatible with
  the workspace's pinned Drizzle RC. Document the migration procedure for development and tests.
- Define the local test issuer and console origins for the integration
  flows. Validate required API settings at startup. Phase 3 adds the
  account and organization fixtures it needs for invitation signup.

## Verification

- All four workspaces built. Both web scaffold pages responded during
  the scaffold check. Both built APIs served `/api/hello` after
  initialization with their runtime credentials.
- Both migration sets applied twice on a disposable PostgreSQL 18.6
  cluster. Each journal had one entry after the second run.
- Both runtime roles read, inserted, updated, and deleted rows in their
  own schemas. PostgreSQL denied cross-schema reads and writes, direct
  journal access, and migration runs with runtime credentials.
- Both built APIs rejected an invalid issuer origin and missing or
  incorrect database passwords. The console also rejected an invalid
  console origin.
