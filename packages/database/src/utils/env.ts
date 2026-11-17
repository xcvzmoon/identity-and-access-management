import { booleanSchema, useEnv } from '@iam/shared/utils';
import * as valibot from 'valibot';

const maxPort = 65_535;
const minPort = 1;
const nonEmptyString = valibot.pipe(valibot.string(), valibot.nonEmpty());
const portEnvSchema = valibot.pipe(
  valibot.optional(valibot.pipe(valibot.string(), valibot.digits()), '5432'),
  valibot.transform(Number),
  valibot.integer(),
  valibot.minValue(minPort),
  valibot.maxValue(maxPort),
);
const databaseEnvSchema = valibot.object({
  host: nonEmptyString,
  port: portEnvSchema,
  user: nonEmptyString,
  password: nonEmptyString,
  database: nonEmptyString,
  ssl: booleanSchema,
  logger: booleanSchema,
});

/** Validated PostgreSQL connection fields and query logging preference. */
export type DatabaseConfig = valibot.InferOutput<typeof databaseEnvSchema>;

/** Workspace path for local configuration, or an explicit environment source. */
export type DatabaseEnvOptions = Pick<
  Parameters<typeof useEnv>[number],
  'workspacePath' | 'source'
>;

/**
 * Loads database configuration through the shared environment loader.
 * Local mode requires the consuming workspace path. Other modes use process variables.
 * Port defaults to 5432; SSL and query logging default to false.
 *
 * @param {DatabaseEnvOptions} options - Local workspace directory or explicit environment source, including `APP_ENV`.
 * @returns {DatabaseConfig} Validated connection fields and logger preference.
 * @throws {Error} When environment validation or file loading fails.
 */
export function useDatabaseEnv(options: DatabaseEnvOptions = {}): DatabaseConfig {
  const env = useEnv({
    ...options,
    schema: {
      db: databaseEnvSchema.entries,
    },
  });
  return env.db;
}
