import type { Page } from 'playwright';
import { inArray } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { constants } from 'node:http2';
import * as valibot from 'valibot';
import { useDatabase } from '../../server/database/index.ts';
import { memberships, users } from '../../server/database/schema.ts';
import { measureRequests } from './request-capacity.ts';

type Tenant = { organizationId: string; ownerId: string };

const SEEDED_MEMBERS = 249;
const REQUESTS = 24;
const CONCURRENCY = 4;

const detailsSchema = valibot.object({
  members: valibot.array(valibot.object({ userId: valibot.string() })),
});

/**
 * Samples the authenticated console details endpoint for an organization with one existing owner.
 * @param {Page} page - Signed-in owner's browser.
 * @param {string} origin - Console HTTPS origin.
 * @param {Tenant} tenant - Disposable organization and its expected owner.
 * @param {string} output - New file for aggregate timings and tenant size.
 */
export async function recordOrganizationCapacity(
  page: Page,
  origin: string,
  tenant: Tenant,
  output: string,
): Promise<void> {
  const { organizationId, ownerId } = tenant;
  const database = useDatabase();
  const endpoint = new URL('/api/v1/management', origin).href;
  const ids = Array.from({ length: SEEDED_MEMBERS }, () => randomUUID());
  const expected = new Set([ownerId, ...ids]);
  const createdAt = new Date();

  await database.transaction(async (tx) => {
    await tx.insert(users).values(
      ids.map((id) => ({
        id,
        email: `${id}@example.test`,
        name: 'Capacity fixture',
      })),
    );
    await tx
      .insert(memberships)
      .values(ids.map((userId) => ({ userId, organizationId, createdAt })));
  });

  try {
    const sample = await measureRequests(REQUESTS, CONCURRENCY, async () => {
      const started = performance.now();
      const response = await page.request
        .post(endpoint, {
          headers: { origin },
          data: {
            action: 'details',
            organizationId,
          },
        })
        .catch(() => null);
      const body: unknown = await response?.json().catch(() => null);
      const duration = performance.now() - started;
      const parsed = valibot.safeParse(detailsSchema, body);
      const status = response?.status();
      await response?.dispose();
      if (status !== constants.HTTP_STATUS_OK || !parsed.success) {
        return null;
      }
      const members = parsed.output.members;
      const received = new Set(members.map((member) => member.userId));
      return members.length === expected.size && expected.isSubsetOf(received) ? duration : null;
    });
    const report = {
      memberCount: expected.size,
      ...sample,
    };
    await writeFile(output, `${JSON.stringify(report)}\n`, { flag: 'wx' });
    assert.equal(sample.successful, REQUESTS);
  } finally {
    await database.delete(users).where(inArray(users.id, ids));
  }
}
