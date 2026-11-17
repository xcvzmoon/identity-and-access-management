import type {
  AnyPgColumn,
  PgTimestampBuilder,
  PgTimestampConfig,
  PgUUIDBuilder,
  SetHasDefault,
  SetNotNull,
  UpdateDeleteAction,
} from 'drizzle-orm/pg-core';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Shared timestamp configuration using dates, time zones, and millisecond precision. */
export const TIMESTAMP_CONFIG = {
  mode: 'date',
  precision: 3,
  withTimezone: true,
} satisfies PgTimestampConfig<'date'>;

/** Timestamp builders preserving nullability and default metadata. */
export type TimestampColumns = {
  createdAt: SetHasDefault<SetNotNull<PgTimestampBuilder>>;
  updatedAt: SetHasDefault<SetNotNull<PgTimestampBuilder>>;
  deletedAt: PgTimestampBuilder;
};

/** Standard timestamp builders with UUID audit actor columns. */
export type AuditTimestampColumns = TimestampColumns & {
  createdBy: SetNotNull<PgUUIDBuilder>;
  updatedBy: PgUUIDBuilder;
  deletedBy: PgUUIDBuilder;
};

/**
 * Builds creation, update, and nullable soft-deletion timestamp columns.
 *
 * All columns use timezone-aware millisecond precision. Drizzle refreshes updatedAt
 * on updates; this is not a PostgreSQL trigger.
 *
 * @returns {TimestampColumns} Builders with database defaults for creation and initial update times.
 *
 * @example
 * ```ts
 * const records = pgTable('records', {
 *   id: generateUuid(),
 *   ...generateTimestamps(),
 * });
 * ```
 */
export function generateTimestamps(): TimestampColumns {
  return {
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG)
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp('deleted_at', TIMESTAMP_CONFIG),
  };
}

/**
 * Adds UUID audit actor columns to the standard timestamp columns.
 *
 * createdBy is required. Actor IDs must be supplied by the caller; they are not
 * inferred from the session. Omit userId to create columns without foreign keys.
 *
 * @param {() => AnyPgColumn<{ data: string }>} [userId] - Lazy reference to the users primary key for all actor columns.
 * @param {UpdateDeleteAction} [createdByOnDelete] - Creator deletion action, defaulting to restrict.
 * @param {UpdateDeleteAction} [updatedByOnDelete] - Updater deletion action, defaulting to set null.
 * @param {UpdateDeleteAction} [deletedByOnDelete] - Deletion actor action, defaulting to set null.
 * @returns {AuditTimestampColumns} Timestamp and actor column builders.
 *
 * @example
 * ```ts
 * const records = pgTable('records', {
 *   id: generateUuid(),
 *   ...generateTimestampsWithAudit(() => users.id),
 * });
 * ```
 */
export function generateTimestampsWithAudit(
  userId?: () => AnyPgColumn<{ data: string }>,
  createdByOnDelete: UpdateDeleteAction = 'restrict',
  updatedByOnDelete: UpdateDeleteAction = 'set null',
  deletedByOnDelete: UpdateDeleteAction = 'set null',
): AuditTimestampColumns {
  const createdBy = uuid('created_by').notNull();
  const updatedBy = uuid('updated_by');
  const deletedBy = uuid('deleted_by');

  if (userId) {
    createdBy.references(userId, { onDelete: createdByOnDelete });
    updatedBy.references(userId, { onDelete: updatedByOnDelete });
    deletedBy.references(userId, { onDelete: deletedByOnDelete });
  }

  return { createdBy, updatedBy, deletedBy, ...generateTimestamps() };
}
