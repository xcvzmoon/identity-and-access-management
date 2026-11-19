import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

export const relations = defineRelations(schema, (relation) => ({
  users: {
    sessions: relation.many.sessions({
      from: relation.users.id,
      to: relation.sessions.userId,
    }),
    accounts: relation.many.accounts({
      from: relation.users.id,
      to: relation.accounts.userId,
    }),
    memberships: relation.many.memberships({
      from: relation.users.id,
      to: relation.memberships.userId,
    }),
    invitations: relation.many.invitations({
      from: relation.users.id,
      to: relation.invitations.inviterId,
    }),
  },
  sessions: {
    user: relation.one.users({
      from: relation.sessions.userId,
      to: relation.users.id,
      optional: false,
    }),
  },
  accounts: {
    user: relation.one.users({
      from: relation.accounts.userId,
      to: relation.users.id,
      optional: false,
    }),
  },
  memberships: {
    user: relation.one.users({
      from: relation.memberships.userId,
      to: relation.users.id,
      optional: false,
    }),
    organization: relation.one.organizations({
      from: relation.memberships.organizationId,
      to: relation.organizations.id,
      optional: false,
    }),
  },
  invitations: {
    user: relation.one.users({
      from: relation.invitations.inviterId,
      to: relation.users.id,
      optional: false,
    }),
    organization: relation.one.organizations({
      from: relation.invitations.organizationId,
      to: relation.organizations.id,
      optional: false,
    }),
  },
  organizations: {
    memberships: relation.many.memberships({
      from: relation.organizations.id,
      to: relation.memberships.organizationId,
    }),
    invitations: relation.many.invitations({
      from: relation.organizations.id,
      to: relation.invitations.organizationId,
    }),
  },
}));
