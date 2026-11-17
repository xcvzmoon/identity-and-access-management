import type { DefineEnvOptions, EnvSource, InferEnvOutput } from '@xcvzlabs/env';
import { EnvValidationError, defineEnv } from '@xcvzlabs/env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

type EnvSchema = Parameters<typeof defineEnv>[number]['schema'];

type UseEnvOptions<TSchema extends EnvSchema> = DefineEnvOptions<TSchema> & {
  workspacePath?: string;
};

function readAppEnvironment(source: EnvSource): 'local' | 'testing' | 'staging' | 'production' {
  const environment = source.APP_ENV;
  if (
    environment === 'local' ||
    environment === 'testing' ||
    environment === 'staging' ||
    environment === 'production'
  ) {
    return environment;
  }
  throw new EnvValidationError([
    {
      envVar: 'APP_ENV',
      path: 'appEnv',
      message: 'Expected APP_ENV to be local, testing, staging, or production.',
    },
  ]);
}

function readWorkspaceEnv(workspacePath: string): EnvSource {
  try {
    const resolvedWorkspacePath = path.resolve(workspacePath, '.env');
    const envFile = readFileSync(resolvedWorkspacePath, 'utf8');
    return parseEnv(envFile);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Loads and validates server configuration for the deployment identified by `APP_ENV`.
 * Local mode reads only the required workspace directory's `.env`, with process
 * variables taking precedence. Relative workspace paths resolve from the working
 * directory. A missing file uses process variables alone, without searching elsewhere.
 * When process variables select testing, staging, or production, no files are read.
 * An explicit `source` replaces all other sources in every environment.
 * If process variables omit `APP_ENV`, reads it from the explicit workspace's `.env`.
 * File values supply application configuration only in local mode; other modes use
 * process variables even when their mode was discovered from a file.
 * Missing or invalid `APP_ENV` values fail validation. Local mode requires a workspace
 * path, even with an explicit source.
 * Does not mutate `process.env` or infer a mode from `NODE_ENV`.
 * Validation and file read errors other than a missing file propagate.
 *
 * @param {UseEnvOptions<TSchema>} options - Schema, local workspace directory, optional source containing `APP_ENV`, and variable naming function.
 * @returns {InferEnvOutput<TSchema>} Environment values inferred from the schema.
 *
 * @example
 * With `APP_ENV=local` in `apps/api/.env`:
 * ```ts
 * import { useEnv } from '@iam/shared/utils';
 * import * as v from 'valibot';
 *
 * const env = useEnv({
 *   workspacePath: 'apps/api',
 *   schema: {
 *     api: {
 *       url: v.pipe(v.string(), v.url()),
 *       key: v.string(),
 *     },
 *   },
 * });
 *
 * const apiUrl = new URL('/api', env.api.url);
 * ```
 */
export function useEnv<TSchema extends EnvSchema>(
  options: UseEnvOptions<TSchema>,
): InferEnvOutput<TSchema> {
  const { workspacePath = '', ...envOptions } = options;
  let source = envOptions.source ?? process.env;
  let appEnvSource = source;
  let workspaceEnv: EnvSource | null = null;

  if (!envOptions.source && !Object.hasOwn(source, 'APP_ENV') && workspacePath !== '') {
    workspaceEnv = readWorkspaceEnv(workspacePath);
    appEnvSource = { ...workspaceEnv, ...process.env };
  }

  const environment = readAppEnvironment(appEnvSource);

  if (environment === 'local') {
    if (workspacePath === '') {
      throw new TypeError('workspacePath is required when APP_ENV is local');
    }

    if (!envOptions.source) {
      source = { ...(workspaceEnv ?? readWorkspaceEnv(workspacePath)), ...process.env };
    }
  }

  return defineEnv({ ...envOptions, source });
}
