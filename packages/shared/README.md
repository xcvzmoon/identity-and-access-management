# Shared utilities

## Environment configuration

Use `useEnv()` on the server to validate configuration once at startup. It reads
`APP_ENV` automatically and accepts `local`, `testing`, `staging`, or `production`.
Process variables take precedence. If `process.env` has no `APP_ENV`, the helper
reads it from the explicit workspace's `.env`. Missing, empty, or invalid values
fail validation; `NODE_ENV` is never used as a fallback.

Local mode requires `workspacePath` and reads only that directory's `.env`.
Process variables override file values. Relative paths resolve from the working
directory; absolute paths work independently of it. A missing file uses process
variables alone, without searching parent or sibling directories.

Testing, staging, and production use only process variables for application
configuration. When `APP_ENV` is supplied by the process, these modes never read
files. If it is absent and `workspacePath` is supplied, the helper reads that
workspace's `.env` to discover the mode, but ignores its configuration values
unless the selected mode is local. In every environment, an explicit `source` replaces
both file values and process variables. It must include its own valid `APP_ENV`;
the helper does not fall back to the process environment, even for an empty source.

The helper returns schema-inferred values without mutating `process.env`.
Validation failures and file read errors other than a missing file are thrown.
Keep validation errors and secrets out of API responses and browser code.
Workspace selection is not a filesystem or process security boundary.

### Shared schema

Define one schema per app and use it in every deployment. These examples use
Valibot; install it in the consuming workspace if it is not already available.
Create `env-schema.ts` in your server code:

```ts
import * as v from 'valibot';

export const envSchema = {
  nodeEnv: v.picklist(['development', 'test', 'production']),
  api: {
    url: v.pipe(v.string(), v.url()),
    key: v.string(),
  },
};
```

The keys above read `NODE_ENV`, `API_URL`, and `API_KEY`. Their validated values
are available as `env.nodeEnv`, `env.api.url`, and `env.api.key`.

### Local

Create `apps/api/.env` with local configuration:

```dotenv
APP_ENV=local
NODE_ENV=development
API_URL=http://localhost:3000
API_KEY=local-example-key
```

When launching from the repository root, initialize server configuration:

```ts
import { useEnv } from '@iam/shared';
import { envSchema } from './env-schema.ts';

export const env = useEnv({
  workspacePath: 'apps/api',
  schema: envSchema,
});
```

Commit `apps/api/.env.example` with the required keys and safe placeholders.
Keep the actual `.env` ignored by Git. Do not commit credentials.

### Testing

Supply explicit values so developer shell variables and local files cannot affect
unit tests:

```ts
import { useEnv } from '@iam/shared';
import { envSchema } from './env-schema.ts';

const env = useEnv({
  schema: envSchema,
  source: {
    APP_ENV: 'testing',
    NODE_ENV: 'test',
    API_URL: 'http://localhost:4000',
    API_KEY: 'test-example-key',
  },
});
```

For integration tests, omit `source` and set `APP_ENV=testing` alongside the other
variables injected by the test runner or CI. Use a separate, disposable database and test credentials.

### Staging

Configure these values in the staging deployment platform:

```dotenv
APP_ENV=staging
NODE_ENV=production
API_URL=https://api.staging.example.com
API_KEY=<injected-staging-secret>
```

Read the injected values without loading files:

```ts
import { useEnv } from '@iam/shared';
import { envSchema } from './env-schema.ts';

export const env = useEnv({
  schema: envSchema,
});
```

Use separate staging credentials and services. Run the production build so staging
exercises the same runtime behavior as production.

### Production

Configure production values through the deployment platform or secret manager:

```dotenv
APP_ENV=production
NODE_ENV=production
API_URL=https://api.example.com
API_KEY=<injected-production-secret>
```

```ts
import { useEnv } from '@iam/shared';
import { envSchema } from './env-schema.ts';

export const env = useEnv({
  schema: envSchema,
});
```

Promote the same server build from staging to production and supply production
values at runtime. Do not include secret `.env` files in the build artifact.

### Selecting the deployment at startup

`APP_ENV` identifies the deployment. `NODE_ENV` controls runtime and framework
behavior. Staging and production normally both use `NODE_ENV=production`.
The helper does not infer one from the other or change either variable.

Use one startup module across deployments. Local mode can discover `APP_ENV`
from the workspace file; staging and production should inject it through the
deployment platform so file loading is skipped:

```ts
import { useEnv } from '@iam/shared';
import { envSchema } from './env-schema.ts';

export const env = useEnv({
  workspacePath: 'apps/api',
  schema: envSchema,
});
```

A present `process.env.APP_ENV` always wins over the file, including an empty or
invalid value, which causes validation to fail. An explicit `source` must contain
its own `APP_ENV` and never falls back to the workspace file. Reading values from
a file does not add them to `process.env`; the helper does not change `APP_ENV`
or `NODE_ENV` for other libraries or frameworks.

Import this configuration module from server code so validation happens once
before serving requests. Pass only validated values to application services.

## Development

Install dependencies:

```sh
vp install
```

Run the unit tests:

```sh
vp test
```

Build the library:

```sh
vp pack
```
