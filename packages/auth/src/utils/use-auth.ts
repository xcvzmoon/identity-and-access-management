import type { Auth } from './auth.ts';
import { useDatabase } from '@iam/database';
import { createAuth } from './auth.ts';
import { useAuthEnv } from './env.ts';

let auth: Auth | null = null;

/**
 * Returns the shared Better Auth server, initializing it once on the first call.
 * Local configuration comes from the auth workspace's .env. Other environments
 * use process variables. The database connection is shared with useDatabase().
 *
 * @returns {Auth} Configured Better Auth server.
 * @throws {Error} When authentication or database configuration is invalid.
 */
export function useAuth(): Auth {
  if (!auth) {
    const options = useAuthEnv();
    const database = useDatabase();

    auth = createAuth(database, options);
  }

  return auth;
}
