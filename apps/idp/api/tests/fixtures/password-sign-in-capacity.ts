import { and, count, eq, sql } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { constants } from 'node:http2';
import { setTimeout as delay } from 'node:timers/promises';
import * as valibot from 'valibot';
import { signInCounts, signInEvents } from '../../server/database/schema.ts';
import { openAuditReader } from './audit-reader.ts';
import { measureRequests } from './request-capacity.ts';

type Telemetry = { issued: number; rejected: number; events: number };
type Reader = ReturnType<typeof openAuditReader>;
type Attempt = (password: string) => Promise<Response>;

const REQUESTS = 3;
const CONCURRENCY = 3;
const EMPTY = 0;
export const SIGN_IN_WINDOW_MS = 11_000;

async function readTelemetry(reader: Reader, userId: string): Promise<Telemetry> {
  const [counts] = await reader
    .select({
      issued: sql<number>`coalesce(sum(${signInCounts.total}) filter (where ${signInCounts.outcome} = 'issued'), 0)::int`,
      rejected: sql<number>`coalesce(sum(${signInCounts.total}) filter (where ${signInCounts.outcome} = 'rejected'), 0)::int`,
    })
    .from(signInCounts)
    .where(eq(signInCounts.entry, 'web_form'));
  const [events] = await reader
    .select({ total: count() })
    .from(signInEvents)
    .where(and(eq(signInEvents.userId, userId), eq(signInEvents.entry, 'web_form')));

  return {
    ...counts,
    events: events.total,
  };
}

/**
 * Reconciles concurrent password responses with the disposable issuer's counters and user history.
 * @param {Attempt} attempt - Sends a single password attempt through the hosted sign-in route.
 * @param {string} password - Verified fixture account's password.
 * @param {string} userId - Expected account for session issuance.
 */
export async function recordPasswordCapacity(
  attempt: Attempt,
  password: string,
  userId: string,
): Promise<void> {
  const output = process.env.IAM_PHASE3_PASSWORD_REPORT;
  if (!output) {
    return;
  }

  const reader = openAuditReader();
  const before = await readTelemetry(reader, userId);
  const success = valibot.object({ user: valibot.object({ id: valibot.literal(userId) }) });
  const denial = valibot.object({ code: valibot.literal('INVALID_EMAIL_OR_PASSWORD') });
  const invalidPassword = randomUUID();

  async function timeAttempt(outcome: 'issued' | 'rejected'): Promise<number | null> {
    const started = performance.now();
    const response = await attempt(outcome === 'issued' ? password : invalidPassword).catch(
      () => null,
    );
    const body: unknown = await response?.json().catch(() => null);
    const elapsed = performance.now() - started;
    const cookies = response?.headers.getSetCookie() ?? [];
    const valid =
      outcome === 'issued'
        ? response?.status === constants.HTTP_STATUS_OK &&
          cookies.length > EMPTY &&
          valibot.is(success, body)
        : response?.status === constants.HTTP_STATUS_UNAUTHORIZED &&
          cookies.length === EMPTY &&
          valibot.is(denial, body);
    return valid ? elapsed : null;
  }

  await delay(SIGN_IN_WINDOW_MS);
  const issued = await measureRequests(REQUESTS, CONCURRENCY, async () => timeAttempt('issued'));
  const midpoint = await readTelemetry(reader, userId);
  await delay(SIGN_IN_WINDOW_MS);
  const rejected = await measureRequests(REQUESTS, CONCURRENCY, async () =>
    timeAttempt('rejected'),
  );
  const after = await readTelemetry(reader, userId);
  const telemetry = {
    issued: after.issued - before.issued,
    rejected: after.rejected - before.rejected,
    events: after.events - before.events,
  };
  const report = { issued, rejected, telemetry };
  await writeFile(output, `${JSON.stringify(report)}\n`, { flag: 'wx' });
  assert.equal(issued.successful, REQUESTS);
  assert.equal(rejected.successful, REQUESTS);
  assert.equal(midpoint.issued - before.issued, REQUESTS);
  assert.equal(midpoint.events - before.events, REQUESTS);
  assert.equal(midpoint.rejected, before.rejected);
  assert.deepEqual(telemetry, {
    issued: REQUESTS,
    rejected: REQUESTS,
    events: REQUESTS,
  });
}
