import { drizzle } from 'drizzle-orm/postgres-js';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import postgres from 'postgres';
import { useEnv } from '../utils/env.ts';
import { relations } from './relations.ts';

const env = useEnv();

/**
 * Shared Drizzle client for the console's PostgreSQL database.
 * Set `DB_LOGGER` to `"true"` to enable query logging.
 */
export const db = drizzle({
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
