import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import type { DatabaseConfig } from './utils/env.ts';
import { drizzle } from 'drizzle-orm/postgres-js';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import postgres from 'postgres';
import { relations } from './relations.ts';

/** A Drizzle database and its application-owned PostgreSQL connection pool. */
export type Database = PostgresJsDatabase<typeof relations> & {
  $client: Sql;
};

/**
 * Creates a lazy PostgreSQL pool and its Drizzle client.
 * Call once during application startup and reuse the result for queries and transactions.
 * Call `database.$client.end()` during shutdown to close the pool.
 *
 * @param {Readonly<DatabaseConfig>} config - Validated connection fields; logger enables drizzle-query-logger when true.
 * @returns {Database} Database with the RC relation registry and underlying pool.
 */
export function createDatabase(config: Readonly<DatabaseConfig>): Database {
  const client = postgres({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
  });
  const logger = config.logger ? new EnhancedQueryLogger() : false;
  return drizzle({ client, relations, logger });
}
