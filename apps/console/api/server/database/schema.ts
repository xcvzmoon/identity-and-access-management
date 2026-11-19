import { index, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const consoleSchema = pgSchema('iam_console');

export const authorizationTransactions = consoleSchema.table(
  'authorization_transactions',
  {
    cookieHash: text('cookie_hash').primaryKey(),
    state: text('state').notNull(),
    nonce: text('nonce').notNull(),
    verifier: text('verifier').notNull(),
    returnTo: text('return_to').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index().on(table.expiresAt)],
);

export const sessions = consoleSchema.table(
  'sessions',
  {
    cookieHash: text('cookie_hash').primaryKey(),
    sub: text('sub').notNull(),
    encryptedAccessToken: text('encrypted_access_token'),
    email: text('email').notNull(),
    name: text('name'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index().on(table.expiresAt)],
);
