import { defineEnv } from '@xcvzlabs/env';
// Use Valibot's conventional `v` alias for schema declarations.
// oxlint-disable-next-line eslint/id-length
import * as v from 'valibot';

type Env = {
  db: v.InferOutput<typeof databaseSchema>;
};

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
const databaseSchema = v.object({
  host: nonEmptyStringSchema,
  port: portSchema,
  user: nonEmptyStringSchema,
  password: nonEmptyStringSchema,
  database: nonEmptyStringSchema,
  ssl: stringToBoolSchema,
  logger: stringToBoolSchema,
});

let env: Env | null = null;

/**
 * Loads the API environment from `process.env` and caches it after validation.
 *
 * @returns {Env} The validated environment configuration.
 * @throws {EnvValidationError} If a required setting is missing or a value is invalid.
 */
export function useEnv(): Env {
  env ??= defineEnv({
    schema: {
      db: databaseSchema,
    },
  });

  return env;
}
