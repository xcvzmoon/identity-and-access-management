import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { useDatabase } from '../database/index.ts';
import {
  invitations,
  memberInvitationDeliveries,
  ownerInvitationDeliveries,
} from '../database/schema.ts';
import { useEnv } from '../utils/env.ts';
import { sendAccountEmail } from '../utils/mail.ts';

const FIRST = 0;
const ONE_DELIVERY = 1;

/** Claims one due invitation, sends its existing link, and removes the claim on acceptance.
 * An interrupted or failed attempt becomes eligible again after the SMTP deadline plus one minute.
 * @param {'owner' | 'member'} kind - Queue for operator or organization invitations.
 * @returns {Promise<void>} Resolves when no work is due or the selected delivery is settled.
 */
export async function deliverNextInvitation(kind: 'owner' | 'member'): Promise<void> {
  const database = useDatabase();
  const env = useEnv();
  const queue = kind === 'owner' ? ownerInvitationDeliveries : memberInvitationDeliveries;
  const roleMatches =
    kind === 'owner'
      ? eq(invitations.role, 'owner')
      : inArray(invitations.role, ['member', 'admin']);
  const subject = kind === 'owner' ? 'Accept organization ownership' : 'Join your organization';
  const attemptId = randomUUID();
  const invitation = await database.transaction(async (transaction) => {
    const candidates = await transaction
      .select({
        id: invitations.id,
        email: invitations.email,
        eligible: sql<boolean>`${invitations.status} = 'pending' AND ${roleMatches} AND ${invitations.expiresAt} > now()`,
      })
      .from(queue)
      .innerJoin(invitations, eq(invitations.id, queue.invitationId))
      .where(lte(queue.nextAttemptAt, sql`now()`))
      .orderBy(queue.nextAttemptAt)
      .limit(ONE_DELIVERY)
      .for('update', {
        of: queue,
        skipLocked: true,
      });

    const candidate = candidates.at(FIRST);
    if (!candidate) {
      return null;
    }

    const selected = eq(queue.invitationId, candidate.id);
    if (!candidate.eligible) {
      await transaction.delete(queue).where(selected);
      return null;
    }

    await transaction
      .update(queue)
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
  await sendAccountEmail(invitation.email, subject, url.href, 'confirmed');
  await database
    .delete(queue)
    .where(and(eq(queue.invitationId, invitation.id), eq(queue.attemptId, attemptId)));
}
