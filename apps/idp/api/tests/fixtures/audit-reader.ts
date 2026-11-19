import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { onTestFinished } from 'vite-plus/test';
import { useEnv } from '../../server/utils/env.ts';

/**
 * Opens a test connection with the audit reader's credentials.
 * @returns {PostgresJsDatabase} Connection closed after the fixture completes.
 */
export function openAuditReader(): PostgresJsDatabase {
  const env = useEnv();
  const user = process.env.IAM_AUDIT_READER_USER;
  const password = process.env.IAM_AUDIT_READER_PASSWORD;

  assert.ok(user && password, 'Supply the audit reader login for this fixture.');
  const client = postgres({
    host: env.db.host,
    port: env.db.port,
    database: env.db.database,
    ssl: env.db.ssl,
    user,
    password,
    max: 1,
  });
  onTestFinished(async () => client.end());
  return drizzle({ client });
}

/**
 * Builds the environment inherited by fixture servers.
 * @returns {NodeJS.ProcessEnv} Server settings with the test reader's credentials removed.
 */
export function serverEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.IAM_AUDIT_READER_USER;
  delete env.IAM_AUDIT_READER_PASSWORD;
  return env;
}
