# Phase 2. Establish the apps and database ownership

[Implementation plan](overview.md)

## Changes

- Establish `apps/idp` and `apps/console` as independent Nuxt build and startup targets. Set the local issuer and console origins explicitly.
- Split schema and migration ownership between the IdP and console. Start with a fresh database. Assign each runtime role access to its own schema and use separate migration credentials.
- Add startup, migration, and fixture entry points for both apps. The initial fixtures include an organization and operator-provisioned invitation.

## Verification

Build both workspaces. Apply both migration sets to an empty database, start each app with its runtime credentials, and try a read and write against the other app's schema. The database must deny both operations. Check that a misconfigured issuer or missing runtime credentials fail startup with a clear error.
