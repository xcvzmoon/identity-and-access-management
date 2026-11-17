import { defineRelations } from 'drizzle-orm';
import * as schema from './schema/index.ts';

export const relations = defineRelations(schema, (helpers) => ({
  users: {
    sessions: helpers.many.sessions({
      from: helpers.users.id,
      to: helpers.sessions.userId,
    }),
    accounts: helpers.many.accounts({
      from: helpers.users.id,
      to: helpers.accounts.userId,
    }),
  },
  sessions: {
    user: helpers.one.users({
      from: helpers.sessions.userId,
      to: helpers.users.id,
    }),
  },
  accounts: {
    user: helpers.one.users({
      from: helpers.accounts.userId,
      to: helpers.users.id,
    }),
  },
}));
