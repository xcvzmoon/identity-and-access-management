import type { Page } from 'playwright';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:http2';
import { expect } from 'vite-plus/test';
import { useDatabase } from '../../server/database/index.ts';
import { memberships, organizations, sessions, users } from '../../server/database/schema.ts';

type FixtureSession = typeof sessions.$inferSelect;

async function checkSessionBinding(
  page: Page,
  origin: string,
  session: FixtureSession,
  organizationId: string,
): Promise<void> {
  const database = useDatabase();
  const otherSessionId = randomUUID();
  const endpoint = new URL('/api/v1/management', origin).href;
  const headers = { origin };
  const data = {
    action: 'rename',

    organizationId,

    name: 'Unapproved change',
  };

  await database.insert(sessions).values({
    id: otherSessionId,

    userId: session.userId,

    token: randomUUID(),

    expiresAt: session.expiresAt,

    passkeyVerifiedAt: new Date(),
  });

  try {
    await database
      .update(sessions)
      .set({ passkeyVerifiedAt: null })
      .where(eq(sessions.id, session.id));

    const otherSession = await page.request.post(endpoint, { data, headers });
    expect(otherSession.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);

    await database
      .update(sessions)
      .set({ passkeyVerifiedAt: sql`now() - interval '6 minutes'` })
      .where(eq(sessions.id, session.id));

    const stale = await page.request.post(endpoint, { data, headers });
    expect(stale.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);

    await database
      .update(sessions)
      .set({ expiresAt: new Date() })
      .where(eq(sessions.id, session.id));

    const expired = await page.request.post(endpoint, { data, headers });
    expect(expired.status()).toBe(constants.HTTP_STATUS_UNAUTHORIZED);
  } finally {
    await database
      .update(sessions)
      .set({
        expiresAt: session.expiresAt,

        passkeyVerifiedAt: session.passkeyVerifiedAt,
      })
      .where(eq(sessions.id, session.id));
    await database.delete(sessions).where(eq(sessions.id, otherSessionId));
  }
}

async function checkMemberAdministration(
  page: Page,
  origin: string,
  ownerUserId: string,
  organizationId: string,
): Promise<void> {
  const database = useDatabase();
  const endpoint = new URL('/api/v1/management', origin).href;
  const headers = { origin };
  const otherUserId = randomUUID();
  const createdAt = new Date();
  const target = and(
    eq(memberships.organizationId, organizationId),
    eq(memberships.userId, otherUserId),
  );
  const acting = and(
    eq(memberships.organizationId, organizationId),
    eq(memberships.userId, ownerUserId),
  );
  const remove = {
    action: 'removeMember',
    organizationId,
    userId: otherUserId,
  };

  await database.insert(users).values({
    id: otherUserId,
    name: 'Former owner',
    email: `${otherUserId}@example.test`,
    emailVerified: true,
  });

  try {
    await database.update(memberships).set({ role: 'admin' }).where(acting);
    await database.insert(memberships).values({
      organizationId,
      userId: otherUserId,
      role: 'admin',
      createdAt,
    });

    const removePeer = await page.request.post(endpoint, {
      headers,
      data: remove,
    });
    expect(removePeer.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);

    const inviteAdmin = await page.request.post(endpoint, {
      headers,
      data: {
        action: 'invite',
        organizationId,
        email: `${randomUUID()}@example.test`,
        role: 'admin',
      },
    });
    expect(inviteAdmin.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);

    await database.update(memberships).set({ role: 'owner' }).where(target);

    const removeOwner = await page.request.post(endpoint, {
      headers,
      data: remove,
    });
    expect(removeOwner.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);

    await database.update(memberships).set({ role: 'owner' }).where(acting);

    const retired = await page.request.post(endpoint, {
      headers,
      data: remove,
    });
    expect(retired.status()).toBe(constants.HTTP_STATUS_OK);

    const remaining = await database.select({ id: memberships.id }).from(memberships).where(target);
    expect(remaining).toEqual([]);

    const self = await page.request.post(endpoint, {
      headers,
      data: {
        ...remove,
        userId: ownerUserId,
      },
    });
    expect(self.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);
  } finally {
    await database.delete(users).where(eq(users.id, otherUserId));
  }
}

/**
 * Exercises the console proxy after the owner verifies their current IAM session.
 * @param {Page} page - Owner's authenticated console browser.
 * @param {string} origin - Console origin.
 * @param {string} ownerUserId - Owner whose membership and IAM session the fixture exercises.
 * @param {string} organizationId - Organization that the owner can administer.
 */
export async function checkManagementIsolation(
  page: Page,
  origin: string,
  ownerUserId: string,
  organizationId: string,
): Promise<void> {
  const database = useDatabase();
  const memberOrganizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const targetIds = [memberOrganizationId, foreignOrganizationId];
  const createdAt = new Date();
  const endpoint = new URL('/api/v1/management', origin).href;
  const headers = { origin };
  const rows = await database.select().from(sessions).where(eq(sessions.userId, ownerUserId));
  const session = rows.find((row) => row.passkeyVerifiedAt);
  if (!session) {
    throw new Error('Expected a stepped-up owner session.');
  }

  await database.insert(organizations).values(
    targetIds.map((id) => ({
      id,

      name: id,

      slug: id,

      createdAt,
    })),
  );

  try {
    await database.insert(memberships).values({
      organizationId: memberOrganizationId,

      userId: ownerUserId,

      role: 'member',

      createdAt,
    });

    const responses = await Promise.all(
      targetIds.map(async (target) =>
        page.request.post(endpoint, {
          headers,

          data: {
            action: 'rename',

            organizationId: target,

            name: 'Unauthorized change',
          },
        }),
      ),
    );
    expect(responses.map((response) => response.status())).toEqual([
      constants.HTTP_STATUS_FORBIDDEN,
      constants.HTTP_STATUS_FORBIDDEN,
    ]);

    const saved = await database
      .select({
        id: organizations.id,

        name: organizations.name,
      })
      .from(organizations)
      .where(inArray(organizations.id, targetIds));
    expect(saved.every(({ id, name }) => id === name)).toBe(true);

    await checkMemberAdministration(page, origin, ownerUserId, memberOrganizationId);
    await checkSessionBinding(page, origin, session, organizationId);
  } finally {
    await database.delete(organizations).where(inArray(organizations.id, targetIds));
  }
}
