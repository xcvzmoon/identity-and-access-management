import { eq } from 'drizzle-orm';
import { log } from 'evlog';
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vite-plus/test';
import { useDatabase } from '../../server/database/index.ts';
import { invitations, memberInvitationDeliveries } from '../../server/database/schema.ts';
import { deliverNextInvitation } from '../../server/services/invitation-delivery.service.ts';
import { seedInvitation } from './invitation.ts';

/** Exercises expiry and cancellation before the phase 7 replica workers start. */
export async function checkInvitationDeliveryExpiry(): Promise<void> {
  const database = useDatabase();
  const failure = vi.spyOn(log, 'error');
  try {
    const options = {
      email: 'queue-fixture@example.invalid',
      expiresAt: new Date('2000-01-01T00:00:00Z'),
    };
    const expired = await seedInvitation(database, options);
    const canceled = await seedInvitation(database, options);
    await database
      .update(invitations)
      .set({ status: 'canceled' })
      .where(eq(invitations.id, canceled.token));
    await database.insert(memberInvitationDeliveries).values([
      {
        invitationId: expired.token,
        attemptId: randomUUID(),
      },
      { invitationId: canceled.token },
    ]);

    await Promise.all([deliverNextInvitation('member'), deliverNextInvitation('member')]);
    await deliverNextInvitation('member');

    expect(failure.mock.calls).toEqual([
      [
        {
          event: 'invitation-delivery-expired',
          queue: 'member',
          previouslyClaimed: true,
        },
      ],
    ]);
    const remaining = await database
      .select({ id: memberInvitationDeliveries.invitationId })
      .from(memberInvitationDeliveries);
    expect(remaining).toEqual([]);
  } finally {
    failure.mockRestore();
  }
}
