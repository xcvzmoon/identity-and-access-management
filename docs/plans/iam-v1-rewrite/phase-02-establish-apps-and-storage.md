# Phase 2. Verify the workspaces and establish database ownership

[Implementation plan](overview.md) · [Target monorepo structure](../../architecture.md#target-monorepo-structure)

## Starting point

The IdP and console already have Nuxt and Nitro scaffolds. Each API has
an environment example and Drizzle entry points. Both
`server/database/schema/index.ts` files are placeholders. This phase
builds on the existing workspace configuration.

`vp run build` passed for all four workspaces. Both web pages and both
API smoke routes responded using the documented local startup commands.
[Local setup](../../local.md)

## Changes

- Align the local environment helper with the nested API directories if
  the rewrite uses that helper.
- Establish a fresh PostgreSQL database with an IdP schema and a console
  schema. Give each API separate migration and runtime credentials.
  Keep each migration history in its API workspace and configure a
  separate database migration journal for each.
- Keep database definitions under each API's `server/database/`. Use the
  existing Drizzle configuration and relation definitions compatible with
  the workspace's pinned Drizzle RC. Add a reproducible database bootstrap
  and migration procedure for development and tests.
- Define the local test issuer and console origins for the integration
  flows. Validate required API settings at startup. Phase 3 adds the
  account and organization fixtures it needs for invitation signup.

## Verification

- Build all four workspaces. Start both web apps and both APIs. Load both
  web pages and call each API's smoke route.
- Provision a disposable database and apply both migration sets using
  their respective migration credentials. Reapply them and verify each
  API's migration journal is independent.
- Verify that each API can read and write its own data with runtime
  credentials. Attempt a read and a write in the other schema and verify
  PostgreSQL denies both. Verify runtime roles cannot run migrations.
- Check that an invalid configured issuer or missing required runtime
  credentials cause a clear startup failure.
