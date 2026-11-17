import type { ForeignKey } from 'drizzle-orm/pg-core';
import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';
import { validate, version } from 'uuid';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { generateTimestamps, generateTimestampsWithAudit, generateUuid } from '../src/index.ts';

const users = pgTable('users', {
  id: generateUuid(),
  ...generateTimestamps(),
});

test('generates fresh UUIDv7 primary keys through runtime defaults', () => {
  const uuidVersion = 7;
  const firstId = valibot.parse(valibot.string(), users.id.defaultFn?.());
  const secondId = valibot.parse(valibot.string(), users.id.defaultFn?.());

  expect(validate(firstId)).toBe(true);
  expect(version(firstId)).toBe(uuidVersion);
  expect(firstId).not.toBe(secondId);
  expect(users.id.primary).toBe(true);
  expect(users.id.default).toBeUndefined();
});

test('preserves timestamp defaults, nullability, and Valibot schema behavior', () => {
  expect(valibot.parse(createInsertSchema(users), {})).toEqual({});
  expect(valibot.parse(createUpdateSchema(users), {})).toEqual({});
  expect(valibot.safeParse(createSelectSchema(users), {}).success).toBe(false);
  expect(users.createdAt.name).toBe('created_at');
  expect(users.createdAt.getSQLType()).toBe('timestamp (3) with time zone');
  expect(users.createdAt.notNull).toBe(true);
  expect(users.createdAt.default).toBeDefined();
  expect(users.updatedAt.default).toBeDefined();
  expect(users.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);
  expect(users.deletedAt.notNull).toBe(false);
  expect(users.deletedAt.default).toBeUndefined();
});

test('requires the creator and attaches audit actor foreign keys with safe defaults', () => {
  const records = pgTable('records', {
    id: generateUuid(),
    ...generateTimestampsWithAudit(() => users.id),
  });
  const insertSchema = createInsertSchema(records);
  const createdBy = valibot.parse(valibot.string(), users.id.defaultFn?.());

  expect(valibot.safeParse(insertSchema, {}).success).toBe(false);
  expect(valibot.parse(insertSchema, { createdBy })).toEqual({ createdBy });
  expect(
    getTableConfig(records).foreignKeys.map(
      ({ onDelete }: Readonly<Pick<ForeignKey, 'onDelete'>>) => onDelete,
    ),
  ).toEqual(['restrict', 'set null', 'set null']);
  for (const foreignKey of getTableConfig(records).foreignKeys) {
    expect(foreignKey.reference().foreignColumns).toEqual([users.id]);
  }
});

test('supports audit columns without foreign keys and explicit delete actions', () => {
  const records = pgTable('records', {
    id: generateUuid('record_id'),
    ...generateTimestampsWithAudit(),
  });
  const events = pgTable('events', {
    ...generateTimestampsWithAudit(() => users.id, 'cascade', 'restrict', 'no action'),
  });

  expect(records.id.name).toBe('record_id');
  expect(getTableConfig(records).foreignKeys).toEqual([]);
  expect(
    getTableConfig(events).foreignKeys.map(
      ({ onDelete }: Readonly<Pick<ForeignKey, 'onDelete'>>) => onDelete,
    ),
  ).toEqual(['cascade', 'restrict', 'no action']);
  expect(records.updatedBy.notNull).toBe(false);
  expect(records.deletedBy.notNull).toBe(false);
});
