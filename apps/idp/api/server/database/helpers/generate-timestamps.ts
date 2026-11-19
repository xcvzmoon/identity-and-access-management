import type { PgTimestampBuilder, SetHasDefault, SetNotNull } from 'drizzle-orm/pg-core';
import { timestamp } from 'drizzle-orm/pg-core';

type TimestampColumn = SetHasDefault<SetNotNull<PgTimestampBuilder>>;
type TimestampColumns = {
  createdAt: TimestampColumn;
  updatedAt: TimestampColumn;
};

export const TIMESTAMP_CONFIG = {
  mode: 'date',
  precision: 3,
  withTimezone: true,
} as const;

/**
 * Drizzle refreshes updatedAt on updates. Both columns default to the database clock on insert.
 *
 * @returns {TimestampColumns} Fresh creation and update timestamp builders.
 */
export function generateTimestamps(): TimestampColumns {
  return {
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG)
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  };
}
