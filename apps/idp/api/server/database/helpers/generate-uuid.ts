import type {
  PgUUIDBuilder,
  SetHasDefault,
  SetHasRuntimeDefault,
  SetIsPrimaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuid } from 'drizzle-orm/pg-core';
import { v7 } from 'uuid';

type UuidPrimaryKey = SetHasRuntimeDefault<SetIsPrimaryKey<SetHasDefault<PgUUIDBuilder>>>;

/**
 * Generates UUIDv7 for Drizzle inserts and direct SQL inserts on PostgreSQL 18 or newer.
 *
 * @param {string} [name] - SQL column name. Drizzle uses the property name when omitted.
 * @returns {UuidPrimaryKey} A fresh UUID primary-key builder.
 */
export function generateUuid(name?: string): UuidPrimaryKey {
  return uuid(name)
    .default(sql`uuidv7()`)
    .primaryKey()
    .$defaultFn(v7);
}
