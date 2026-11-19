import {
  bigint,
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateTimestamps } from './helpers/generate-timestamps.ts';
import { generateUuid } from './helpers/generate-uuid.ts';

export const idpSchema = pgSchema('iam_idp');

export const users = idpSchema.table(
  'users',
  {
    id: generateUuid(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    ...generateTimestamps(),
  },
  (table) => [unique().on(table.email)],
);

export const sessions = idpSchema.table(
  'sessions',
  {
    id: generateUuid(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    token: text('token').notNull(),
    ...generateTimestamps(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id'),
  },
  (table) => [unique().on(table.token), index('sessions_userId_idx').on(table.userId)],
);

export const accounts = idpSchema.table(
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
  (table) => [
    unique().on(table.providerId, table.accountId),
    index('accounts_userId_idx').on(table.userId),
  ],
);

export const verifications = idpSchema.table(
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

export const organizations = idpSchema.table(
  'organizations',
  {
    id: generateUuid(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    metadata: text('metadata'),
  },
  (table) => [unique().on(table.slug)],
);

export const memberships = idpSchema.table(
  'memberships',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
  },
  (table) => [
    unique().on(table.organizationId, table.userId),
    index('memberships_userId_idx').on(table.userId),
  ],
);

export const invitations = idpSchema.table(
  'invitations',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitations_organizationId_idx').on(table.organizationId),
    index('invitations_inviterId_idx').on(table.inviterId),
    index('invitations_email_idx').on(table.email),
  ],
);

export const rateLimits = idpSchema.table(
  'rate_limits',
  {
    id: generateUuid(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [unique().on(table.key)],
);
