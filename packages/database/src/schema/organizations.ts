import { index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateUuid } from '../helpers/index.ts';
import { iamSchema, users } from './auth.ts';

/** IAM organizations and their access status. */
export const organizations = iamSchema.table('organizations', {
  id: generateUuid(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
  disabledAt: timestamp('disabled_at', TIMESTAMP_CONFIG),
});

/** Organization memberships with roles and suspension status. */
export const members = iamSchema.table(
  'members',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    suspendedAt: timestamp('suspended_at', TIMESTAMP_CONFIG),
  },
  (table) => [
    unique('members_organization_user_unique').on(table.organizationId, table.userId),
    unique('members_organization_id_unique').on(table.organizationId, table.id),
    index('members_user_idx').on(table.userId),
  ],
);

/** Email invitations and their issuing members. */
export const invitations = iamSchema.table(
  'invitations',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitations_organization_idx').on(table.organizationId),
    index('invitations_email_idx').on(table.email),
    index('invitations_inviter_idx').on(table.inviterId),
  ],
);
