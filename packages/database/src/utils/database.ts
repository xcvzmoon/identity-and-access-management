import type { Database } from './client.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.ts';
import { useDatabaseEnv } from './env.ts';

let database: Database | null = null;

/**
 * Returns the shared database client, initializing it once on the first call.
 * Local configuration comes from the database workspace's .env; process variables
 * take precedence. Testing, staging, and production use process variables only.
 * Connections open on the first query. Close the pool with `$client.end()` at
 * application shutdown. SQL parameter logging is disabled for credential safety.
 *
 * @returns {Database} Shared Drizzle client and PostgreSQL pool.
 * @throws {Error} When database configuration is missing or invalid.
 */
export function useDatabase(): Database {
  if (!database) {
    const environment = process.env.APP_ENV;
    const workspacePath =
      !environment || environment === 'local'
        ? path.dirname(fileURLToPath(import.meta.resolve('@iam/database/package.json')))
        : '';
    const config = useDatabaseEnv({ workspacePath });

    database = createDatabase({
      ...config,
      logger: false,
    });
  }

  return database;
}
