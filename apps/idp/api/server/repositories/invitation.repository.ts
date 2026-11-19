import { and, eq, gt, sql } from 'drizzle-orm';
import { useDatabase } from '../database/index.ts';
import { invitations } from '../database/schema.ts';

const FIRST_RESULT = 0;

function throwInvitationStorageError(): never {
  throw new Error('Invitation storage operation failed.');
}

/**
 * Checks eligibility at query time without reserving the invitation.
 *
 * @param {string} token - Invitation ID from the emailed link.
 * @param {string} email - Address to match against the invitation.
 * @returns {Promise<boolean>} Whether an unexpired, unaccepted invitation matches both values.
 * @throws {Error} When the query fails. The error omits SQL and bound parameters.
 */
export async function hasEligibleInvitation(token: string, email: string): Promise<boolean> {
  const database = useDatabase();
  const matches = await database
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.id, token),
        eq(invitations.email, email.toLowerCase()),
        eq(invitations.status, 'pending'),
        gt(invitations.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .catch(throwInvitationStorageError);

  return Boolean(matches.at(FIRST_RESULT));
}
