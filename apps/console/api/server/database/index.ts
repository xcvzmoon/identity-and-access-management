import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import postgres, { type Sql } from 'postgres';
import { useEnv } from '../utils/env.ts';
import { relations } from './relations.ts';

type Database = PostgresJsDatabase<typeof relations> & { $client: Sql };

let db: Database | null = null;

/**
 * Shared Drizzle client for the console's PostgreSQL database.
 * Set `DB_LOGGER` to `"true"` to enable query logging.
 *
 * @returns {Database} The connection pool shared by the API process.
 */
export function useDatabase(): Database {
  if (db !== null) {
    return db;
  }

  const env = useEnv();
  db = drizzle({
    client: postgres({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      ssl: env.db.ssl,
    }),
    logger: env.db.logger && new EnhancedQueryLogger(),
    relations,
  });
  return db;
}
