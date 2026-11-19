import { and, eq, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { useDatabase } from '../database/index.ts';
import { invitations, ownerInvitationDeliveries } from '../database/schema.ts';
import { useEnv } from '../utils/env.ts';
import { sendAccountEmail } from '../utils/mail.ts';

const FIRST = 0;
const ONE_DELIVERY = 1;

/** Claims one due owner invitation, sends its existing link, and removes the claim on acceptance.
 * An interrupted or failed attempt becomes eligible again after the SMTP deadline plus one minute.
 * @returns {Promise<void>} Resolves when no work is due or the selected delivery is settled.
 */
export async function deliverNextOwnerInvitation(): Promise<void> {
  const database = useDatabase();
  const env = useEnv();
  const attemptId = randomUUID();
  const invitation = await database.transaction(async (transaction) => {
    const candidates = await transaction
      .select({
        id: invitations.id,
        email: invitations.email,
        eligible: sql<boolean>`${invitations.status} = 'pending' AND ${invitations.role} = 'owner' AND ${invitations.expiresAt} > now()`,
      })
      .from(ownerInvitationDeliveries)
      .innerJoin(invitations, eq(invitations.id, ownerInvitationDeliveries.invitationId))
      .where(lte(ownerInvitationDeliveries.nextAttemptAt, sql`now()`))
      .orderBy(ownerInvitationDeliveries.nextAttemptAt)
      .limit(ONE_DELIVERY)
      .for('update', {
        of: ownerInvitationDeliveries,
        skipLocked: true,
      });

    const candidate = candidates.at(FIRST);
    if (!candidate) {
      return null;
    }

    const selected = eq(ownerInvitationDeliveries.invitationId, candidate.id);
    if (!candidate.eligible) {
      await transaction.delete(ownerInvitationDeliveries).where(selected);
      return null;
    }

    await transaction
      .update(ownerInvitationDeliveries)
      .set({
        attemptId,
        nextAttemptAt: sql`now() + interval '1 minute' + ${env.smtp.confirmedTimeoutMs}::integer * interval '1 millisecond'`,
      })
      .where(selected);

    return candidate;
  });

  if (!invitation) {
    return;
  }

  const url = new URL('/invite', env.oidcIssuerUrl);
  url.hash = new URLSearchParams({ token: invitation.id }).toString();
  await sendAccountEmail(invitation.email, 'Accept organization ownership', url.href, 'confirmed');
  await database
    .delete(ownerInvitationDeliveries)
    .where(
      and(
        eq(ownerInvitationDeliveries.invitationId, invitation.id),
        eq(ownerInvitationDeliveries.attemptId, attemptId),
      ),
    );
}
