# Shared package reference

[Documentation index](README.md)

`@iam/shared` provides Valibot contracts and environment validation.
The package exposes data schemas and server configuration through separate
import paths.

| Import              | Public API                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `@iam/shared/types` | Valibot select, insert, and update schemas and inferred TypeScript types for the auth tables |
| `@iam/shared/utils` | `useEnv()` and `booleanSchema` for validating configuration                                  |

## Auth data contracts

The [type modules](../packages/shared/src/types/index.ts) derive their Valibot schemas from the
[database schema](database.md#authentication-tables). Each group
exports `select…Schema`, `input…Schema`, and `update…Schema`, along with the
inferred select, insert, and update types.

| Table contract | Read type      | Schema examples                                                                   |
| -------------- | -------------- | --------------------------------------------------------------------------------- |
| User           | `User`         | `selectUserSchema`, `inputUserSchema`, `updateUserSchema`                         |
| Account        | `Account`      | `selectAccountSchema`, `inputAccountSchema`, `updateAccountSchema`                |
| Session        | `Session`      | `selectSessionSchema`, `inputSessionSchema`, `updateSessionSchema`                |
| Verification   | `Verification` | `selectVerificationSchema`, `inputVerificationSchema`, `updateVerificationSchema` |
| Rate limit     | `RateLimit`    | `selectRateLimitSchema`, `inputRateLimitSchema`, `updateRateLimitSchema`          |

Row schemas include database fields, including credential and token fields
on some tables. Select the public fields before you serialize a row. The
following example builds a view of a session user.

```ts
import { selectUserSchema } from '@iam/shared/types';
import * as v from 'valibot';

const sessionUserSchema = v.pick(selectUserSchema, ['id', 'email', 'name', 'emailVerified']);
type SessionUser = v.InferOutput<typeof sessionUserSchema>;
```

[HTTP session response](../apps/api/server/utils/auth-http.ts)

## Environment validation

[`useEnv()`](../packages/shared/src/utils/env.ts) validates configuration against a schema and
returns inferred types. The helper reads files and process variables without
mutating `process.env`. Call it from server initialization so callers receive
validated values.

| Source or mode                        | Values used                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit `source`                     | Uses only the supplied object. The object must include a valid `APP_ENV`. This is useful when testing independently of local files and process variables.                                    |
| `local`                               | Loads `.env` from the supplied workspace and lets process variables win. Local mode requires `workspacePath`. A missing file leaves process variables as the only source.                    |
| `testing`, `staging`, or `production` | Validates process variables. When the process omits `APP_ENV`, the helper may inspect the explicit workspace file to discover the mode. Only local mode uses that file for the other values. |

`APP_ENV` selects the mode. A present process value takes precedence over
the file, including an empty or invalid value. Missing or invalid modes and
invalid settings throw validation errors. Relative workspace paths resolve
from the working directory, and absolute paths work regardless of it. File
lookup stays within the explicit workspace path.

[`booleanSchema`](../packages/shared/src/utils/schema.ts) accepts the strings `"true"` and
`"false"` and returns a boolean. A missing value defaults to `false`.

### Example configuration

A nested `worker` group maps `url` to `WORKER_URL` and `enabled` to
`WORKER_ENABLED`. Pass the schema to `useEnv()` at startup.

```ts
import { booleanSchema, useEnv } from '@iam/shared/utils';
import * as v from 'valibot';

const schema = {
  worker: {
    url: v.pipe(v.string(), v.url()),
    enabled: booleanSchema,
  },
};

const env = useEnv({
  workspacePath: import.meta.dirname,
  schema,
});
```

For local development, place these values in `.env` next to the configuration
module.

```dotenv
APP_ENV="local"
WORKER_URL="http://localhost:4000"
WORKER_ENABLED="true"
```

For unit tests, pass an explicit source with `APP_ENV: 'testing'`. For
deployed services, supply the variables through the process environment.
Keep validation errors and secret values out of browser responses.

## Development

The database package consumes `@iam/shared/utils`, and the shared type
schemas consume `@iam/database/schema`. The root build handles the order
by building shared utilities first, then database, then the full shared
package and its consumers.

```sh
vp run build
```

After prerequisites are built, target this package with the root script
alias.

```sh
vp run packages:shared build
vp run packages:shared typecheck
vp run packages:shared test
```

The [environment tests](../packages/shared/tests/env.test.ts) cover file lookup, process
precedence, explicit sources, environment inference, and validation errors.
