import type { EnvSource, InferEnvOutput } from '@xcvzlabs/env';
import { EnvValidationError, defineEnv } from '@xcvzlabs/env';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
// Use Valibot's conventional `v` alias for schema declarations.
// oxlint-disable-next-line eslint/id-length
import * as v from 'valibot';

type Env = InferEnvOutput<typeof runtimeSchema>;

const MIN_PORT = 1;
const MAX_PORT = 65_535;

const nonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

const portSchema = v.pipe(
  v.optional(v.pipe(v.string(), v.digits()), '5432'),
  v.transform(Number),
  v.integer(),
  v.minValue(MIN_PORT),
  v.maxValue(MAX_PORT),
);

const stringToBoolSchema = v.pipe(
  v.optional(v.picklist(['true', 'false']), 'false'),
  v.transform((value) => value === 'true'),
);

export const databaseSchema = {
  host: nonEmptyStringSchema,
  port: portSchema,
  user: nonEmptyStringSchema,
  password: nonEmptyStringSchema,
  database: nonEmptyStringSchema,
  ssl: stringToBoolSchema,
  logger: stringToBoolSchema,
};

const httpsOriginSchema = v.pipe(
  v.string(),
  v.check(
    (value) => value.startsWith('https://') && URL.parse(value)?.origin === value,
    'Expected an HTTPS origin without a path, query, or fragment.',
  ),
);

const runtimeSchema = {
  db: databaseSchema,
  oidcIssuerUrl: httpsOriginSchema,
  consoleOrigin: httpsOriginSchema,
  oidcClientSecret: nonEmptyStringSchema,
};

let env: Env | null = null;

function validateEnv(source: EnvSource): Env {
  return defineEnv({
    schema: runtimeSchema,
    source,
  });
}

function getInvalidEnvKeys(path: string): string[] | null {
  try {
    const envFile = readFileSync(path, 'utf8');
    const envContents = parseEnv(envFile);
    validateEnv(envContents);
    return null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `Missing ${path}. Copy .env.example to .env and fill in the required values.`,
        { cause: error },
      );
    }

    if (!(error instanceof EnvValidationError)) {
      throw error;
    }

    return error.issues.map(({ envVar }) => envVar);
  }
}

export function checkEnvFile(path: string): void {
  const invalidKeys = getInvalidEnvKeys(path);
  if (invalidKeys !== null) {
    throw new Error(`Invalid environment settings in ${path} for ${invalidKeys.join(', ')}.`);
  }
}

/**
 * Validates and caches the runtime environment during startup.
 *
 * @throws {EnvValidationError} If a required setting is missing or invalid.
 */
export function initializeEnv(): void {
  env ??= validateEnv(process.env);
}

/**
 * @returns {Env} The runtime settings validated at startup.
 * @throws {Error} If the runtime environment has yet to be initialized.
 */
export function useEnv(): Env {
  if (env === null) {
    throw new Error('The runtime environment has not been initialized.');
  }

  return env;
}
