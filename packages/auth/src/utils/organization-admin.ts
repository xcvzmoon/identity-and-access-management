import type { useDatabase } from '@iam/database';
import { schema } from '@iam/database';
import { and, eq, isNull } from 'drizzle-orm';

type DatabaseReader = Pick<ReturnType<typeof useDatabase>, 'select'>;
type OrganizationAuthority = 'owner' | 'owner-or-admin';
type AuthorityCheck = {
  organizationId: string;
  actorId: string;
  authority: OrganizationAuthority;
  mode: 'read' | 'lock';
};

async function checkOrganizationAuthority(
  database: DatabaseReader,
  check: AuthorityCheck,
): Promise<boolean> {
  const { organizationId, actorId, authority, mode } = check;
  const query = database
    .select({ role: schema.members.role })
    .from(schema.members)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.members.organizationId))
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(
      and(
        eq(schema.members.organizationId, organizationId),
        eq(schema.members.userId, actorId),
        eq(schema.users.emailVerified, true),
        isNull(schema.users.deletedAt),
        isNull(schema.organizations.disabledAt),
        isNull(schema.members.suspendedAt),
      ),
    );
  const memberships = await (mode === 'lock' ? query.for('share') : query);
  return memberships.some(({ role }) =>
    role
      .split(',')
      .some(
        (roleName) =>
          roleName === 'owner' || (authority === 'owner-or-admin' && roleName === 'admin'),
      ),
  );
}

/**
 * Checks active, verified organization authority and holds membership locks until commit.
 * @param {DatabaseReader} transaction - The transaction performing the authorized write.
 * @param {string} organizationId - The organization that owns the operation.
 * @param {string} actorId - The authenticated user to check.
 * @param {OrganizationAuthority} authority - Required role. Defaults to owner or admin.
 * @returns {Promise<boolean>} Whether the actor has that authority.
 */
export async function lockOrganizationAdmin(
  transaction: DatabaseReader,
  organizationId: string,
  actorId: string,
  authority: OrganizationAuthority = 'owner-or-admin',
): Promise<boolean> {
  return checkOrganizationAuthority(transaction, {
    organizationId,
    actorId,
    authority,
    mode: 'lock',
  });
}

/**
 * Checks current ownership for reads that do not require a membership lock.
 * @param {DatabaseReader} database - The database serving the read.
 * @param {string} organizationId - The organization to check.
 * @param {string} actorId - The authenticated user to check.
 * @returns {Promise<boolean>} Whether the actor is an active, verified owner.
 */
export async function isOrganizationOwner(
  database: DatabaseReader,
  organizationId: string,
  actorId: string,
): Promise<boolean> {
  return checkOrganizationAuthority(database, {
    organizationId,
    actorId,
    authority: 'owner',
    mode: 'read',
  });
}
