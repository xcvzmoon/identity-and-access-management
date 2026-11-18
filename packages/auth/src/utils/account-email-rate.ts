import type { useDatabase } from '@iam/database';
import { schema } from '@iam/database';
import { lt } from 'drizzle-orm';

type Database = Pick<ReturnType<typeof useDatabase>, 'insert'>;
const millisecondsPerSecond = 1000;
/** Keeps recovery cooldown rows inside Better Auth's shared retention window. */
export const passwordRecoveryCooldownSeconds = 300;
const recoveryCooldownMs = passwordRecoveryCooldownSeconds * millisecondsPerSecond;
const firstRow = 0;
const cooldownCount = 1;

export async function reservePasswordRecoveryEmail(
  database: Database,
  userId: string,
): Promise<boolean> {
  const { rateLimits } = schema;
  const now = Date.now();
  const deliveries = await database
    .insert(rateLimits)
    .values({
      key: `iam:password-recovery:${userId}`,
      count: cooldownCount,
      lastRequest: now,
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { lastRequest: now },
      setWhere: lt(rateLimits.lastRequest, now - recoveryCooldownMs),
    })
    .returning({ id: rateLimits.id });

  return Boolean(deliveries.at(firstRow));
}
