import type { useDatabase } from '../../server/database/index.ts';
import { v7 } from 'uuid';
import { invitations, memberships, organizations, users } from '../../server/database/schema.ts';

type Database = ReturnType<typeof useDatabase>;
type InvitationFixture = { token: string; organizationId: string };

type FixtureOptions = {
  email: string;
  expiresAt?: Date;
};

const INVITATION_LIFETIME_MS = 3_600_000;

/**
 * Seeds one organization and invitation in a disposable database.
 *
 * @param {Database} database - Connection to the test database.
 * @param {FixtureOptions} options - Invited email and optional expiration time.
 * @returns {Promise<InvitationFixture>} The bearer token and the organization it admits the user to.
 */
export async function seedInvitation(
  database: Database,
  options: FixtureOptions,
): Promise<InvitationFixture> {
  const organizationId = v7();
  const inviterId = v7();
  const token = v7();
  const createdAt = new Date();

  await database.transaction(async (transaction) => {
    await transaction.insert(users).values({
      id: inviterId,
      name: 'Fixture owner',
      email: `owner-${inviterId}@example.test`,
      emailVerified: true,
    });
    await transaction.insert(organizations).values({
      id: organizationId,
      name: 'Fixture organization',
      slug: organizationId,
      createdAt,
    });
    await transaction.insert(memberships).values({
      userId: inviterId,
      organizationId,
      role: 'owner',
      createdAt,
    });
    await transaction.insert(invitations).values({
      id: token,
      inviterId,
      organizationId,
      role: 'member',
      email: options.email.trim().toLowerCase(),
      expiresAt: options.expiresAt ?? new Date(Date.now() + INVITATION_LIFETIME_MS),
    });
  });

  return { token, organizationId };
}
