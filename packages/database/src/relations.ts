import { defineRelations } from 'drizzle-orm';
import * as schema from './schema/index.ts';

export const relations = defineRelations(schema, (helpers) => ({
  users: {
    members: helpers.many.members({
      from: helpers.users.id,
      to: helpers.members.userId,
    }),
    sessions: helpers.many.sessions({
      from: helpers.users.id,
      to: helpers.sessions.userId,
    }),
    accounts: helpers.many.accounts({
      from: helpers.users.id,
      to: helpers.accounts.userId,
    }),
  },
  organizations: {
    members: helpers.many.members({
      from: helpers.organizations.id,
      to: helpers.members.organizationId,
    }),
    invitations: helpers.many.invitations({
      from: helpers.organizations.id,
      to: helpers.invitations.organizationId,
    }),
  },
  members: {
    organization: helpers.one.organizations({
      from: helpers.members.organizationId,
      to: helpers.organizations.id,
    }),
    user: helpers.one.users({
      from: helpers.members.userId,
      to: helpers.users.id,
    }),
  },
  invitations: {
    organization: helpers.one.organizations({
      from: helpers.invitations.organizationId,
      to: helpers.organizations.id,
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
