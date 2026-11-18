# Validate changes

[Documentation index](README.md)

## Validation

```sh
vp check
vp test --run
vp run typecheck
vp run build
```

### Integration tests

Use a disposable PostgreSQL database named `iam` on `127.0.0.1`. Give the
`iam` role ownership. The tests use password `disposable` or local trust
authentication. They create and delete test records.

The following commands use a fixture on port 55439.

```sh
APP_ENV="testing" DB_HOST="127.0.0.1" DB_PORT="55439" DB_USER="iam" \
	DB_PASSWORD="disposable" DB_DATABASE="iam" DB_SSL="false" \
	vp run packages:database migrate

AUTH_TEST_DB_PORT="55439" vp test --run apps/api/tests
```

The API tests run in process. The static web and hosted OIDC tests also need
a running IAM build against the fixture. [Web integration test setup](#hosted-web-fixtures)

## API validation

```sh
vp run apps:api typecheck
vp test --run apps/api/tests
```

Set `AUTH_TEST_DB_PORT` to run tests against a disposable PostgreSQL fixture.
[Integration test setup](#integration-tests)

## Hosted web fixtures

```sh
vp run apps:web typecheck
vp run build
```

Start the built IAM server with a disposable migrated PostgreSQL database.
Set `AUTH_TEST_DB_PORT` to its database port and `AUTH_WEB_TEST_URL` to
the IAM origin when running the static web, administrator, and machine tests.

```sh
AUTH_TEST_DB_PORT="55439" AUTH_WEB_TEST_URL="http://localhost:5173" \
  vp test apps/web/tests/static-web.integration.test.ts
```

The suite checks delivery of the UI and JavaScript assets, same-origin
signup and sign-in, and the Better Auth session lifecycle.

## Database validation

```sh
vp run packages:database build
vp run packages:database typecheck
vp run packages:database check
vp run test packages/database/tests
```

Use `vp run build` first on a fresh checkout to build the shared utility
entry point that this package consumes. Unit tests cover configuration,
runtime defaults, and lazy pool reuse. The [API integration
suite](#api-validation) covers real auth queries against
a disposable PostgreSQL database.

## Select the fixture for the change

| Fixture                      | Cases and setup                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default `vp test --run`      | Unit and in-memory provider tests, workspace discovery, environment validation, auth surface checks, and client validation. Fixture-dependent cases skip when their settings are missing.                             |
| Disposable PostgreSQL        | Set `AUTH_TEST_DB_PORT` for real database access and middleware tests, recovery, invitations, ownership, and private app access.                                                                                      |
| Built IAM and browser assets | Set `AUTH_WEB_TEST_URL` to the running IAM origin and `AUTH_TEST_DB_PORT` to its database port. Cover UI delivery, browser sessions, and machine keys. Export the fixture's `AUTH_SECRET` for the admin passkey test. |
| Hosted OIDC                  | Set `AUTH_OIDC_TEST_URL` and `AUTH_TEST_DB_PORT`. Some cases require the fixture's `AUTH_SECRET` to arrange database or provider state.                                                                               |
| Replica and outage rehearsal | Add `AUTH_OIDC_REPLICA_TEST_URL` and `AUTH_OIDC_UNAVAILABLE_TEST_URL` for the second replica and outage fixture.                                                                                                      |
| Issuer key rotation          | Use a fresh migrated database. Set `AUTH_SIGNING_KEY_ROTATION_TEST="true"` and `AUTH_TEST_DB_PORT`.                                                                                                                   |

For a local-only run, record the skipped tests as skips. Hosted and replica
checks require an actual running build. Run the replica rehearsal against a
fresh database to avoid consuming the shared rate limits with a different
suite. Keep fixture secrets and the test database separate from deployed
environments.

[Review coverage matrix](review.md#review-matrix) · [Replica setup](pilot.md#pilot-replica-check)
