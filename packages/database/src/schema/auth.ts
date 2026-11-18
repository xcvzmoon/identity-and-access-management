import {
  bigint,
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateTimestamps, generateUuid } from '../helpers/index.ts';

export const iamSchema = pgSchema('iam');

export const users = iamSchema.table('users', {
  id: generateUuid(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  ...generateTimestamps(),
});

/** IAM sessions, including the passkey and time of the last admin verification. */
export const sessions = iamSchema.table(
  'sessions',
  {
    id: generateUuid(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    token: text('token').notNull().unique(),
    ...generateTimestamps(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: uuid('active_organization_id'),
    adminPasskeyId: uuid('admin_passkey_id'),
    adminVerifiedAt: timestamp('admin_verified_at', TIMESTAMP_CONFIG),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [index('sessions_userId_idx').on(table.userId)],
);

export const accounts = iamSchema.table(
  'accounts',
  {
    id: generateUuid(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', TIMESTAMP_CONFIG),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', TIMESTAMP_CONFIG),
    scope: text('scope'),
    password: text('password'),
    ...generateTimestamps(),
  },
  (table) => [index('accounts_userId_idx').on(table.userId)],
);

export const verifications = iamSchema.table(
  'verifications',
  {
    id: generateUuid(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    ...generateTimestamps(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const rateLimits = iamSchema.table('rate_limits', {
  id: generateUuid(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
