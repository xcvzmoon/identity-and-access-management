import { bigint, boolean, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateUuid } from '../helpers/index.ts';
import { iamSchema, users } from './auth.ts';

/** WebAuthn passkey credentials registered to IAM accounts. */
export const passkeys = iamSchema.table(
  'passkeys',
  {
    id: generateUuid(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull().unique(),
    counter: bigint('counter', { mode: 'number' }).notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG),
    aaguid: text('aaguid'),
  },
  (table) => [index('passkeys_user_idx').on(table.userId)],
);
