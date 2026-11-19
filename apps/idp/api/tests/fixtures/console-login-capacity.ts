import type { Page } from 'playwright';
import type postgres from 'postgres';
import type { RequestSample } from './request-capacity.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { measureRequests } from './request-capacity.ts';

type Workload = {
  page: Page;
  origin: string;
  issuer: string;
  client: postgres.Sql;
};

type Sample = RequestSample & {
  seeded: number;
  expiredAfter: number;
  liveAfter: number;
};

const REQUESTS = 128;
const CONCURRENCY = 8;
const EXPIRED_BACKLOG = 12_800;
const EMPTY = 0;
const SEE_OTHER = 303;

async function timeRedirect(page: Page, login: URL, authorize: URL): Promise<number | null> {
  const sent = performance.now();
  const response = await page.request.get(login.href, { maxRedirects: 0 }).catch(() => null);
  const elapsed = performance.now() - sent;
  const location = URL.parse(response?.headers().location ?? '');
  const valid =
    response?.status() === SEE_OTHER &&
    location?.origin === authorize.origin &&
    location.pathname === authorize.pathname &&
    Boolean(location.searchParams.get('state'));
  await response?.dispose();
  return valid ? elapsed : null;
}

async function measure(workload: Workload, seeded: number): Promise<Sample> {
  const { page, origin, issuer, client } = workload;
  const destination = new URL(`/account?rehearsal=${randomUUID()}`, origin);
  const login = new URL('/api/v1/login', origin);
  const authorize = new URL('/api/v1/auth/oauth2/authorize', issuer);
  login.searchParams.set('returnTo', destination.href);

  try {
    await client`INSERT INTO iam_console.authorization_transactions
      (cookie_hash, state, nonce, verifier, return_to, expires_at)
      SELECT uuidv7()::text, 'fixture', 'fixture', 'fixture', ${destination.href}, now() - interval '1 hour'
      FROM generate_series(1, ${seeded}::int)`;
    const sample = await measureRequests(REQUESTS, CONCURRENCY, async () =>
      timeRedirect(page, login, authorize),
    );
    const [rows] = await client<{ expired: number; live: number }[]>`SELECT
      count(*) FILTER (WHERE expires_at <= now())::int AS expired,
      count(*) FILTER (WHERE expires_at > now())::int AS live
      FROM iam_console.authorization_transactions WHERE return_to = ${destination.href}`;

    return {
      seeded,
      ...sample,
      expiredAfter: rows.expired,
      liveAfter: rows.live,
    };
  } finally {
    await client`DELETE FROM iam_console.authorization_transactions WHERE return_to = ${destination.href}`;
  }
}

/**
 * Measures console login initiation with an empty and a seeded expiry backlog.
 * @param {Workload} workload - Running phase 6 console, browser and disposable database.
 * @param {string} output - New file for aggregate request timings and transaction counts.
 */
export async function recordLoginCapacity(workload: Workload, output: string): Promise<void> {
  const baseline = await measure(workload, EMPTY);
  const backlog = await measure(workload, EXPIRED_BACKLOG);
  const report = { baseline, backlog };
  await writeFile(output, `${JSON.stringify(report)}\n`, { flag: 'wx' });

  for (const sample of [baseline, backlog]) {
    assert.equal(sample.failed, EMPTY);
    assert.equal(sample.expiredAfter, EMPTY);
    assert.equal(sample.liveAfter, REQUESTS);
  }
}
