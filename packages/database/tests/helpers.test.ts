import { pgTable } from 'drizzle-orm/pg-core';
import { validate, version } from 'uuid';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { generateUuid } from '../src/index.ts';

const users = pgTable('users', {
  id: generateUuid(),
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
