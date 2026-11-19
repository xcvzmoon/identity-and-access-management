import type { Page } from 'playwright';
import { and, eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { authorizationEvents, signInEvents } from '../server/database/schema.ts';
import { assignAppRole, revokeAppGrant } from '../server/services/registration.service.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { openAuditReader, serverEnvironment } from './fixtures/audit-reader.ts';
import { tabTo } from './fixtures/keyboard.ts';
import { checkInstallationConsent } from './fixtures/oidc-consent.ts';
import { authorizationUrl, exchange } from './fixtures/oidc-protocol.ts';
import { seedOidc } from './fixtures/oidc.ts';
import { verifySigningKeys } from './fixtures/signing-keys.ts';
import { recordExchangeCapacity } from './fixtures/token-exchange-capacity.ts';

type Reader = ReturnType<typeof openAuditReader>;
type Fixture = Awaited<ReturnType<typeof seedOidc>>;

const TIMEOUT = 45_000;
const ONE_APPROVAL = 1;
const RANDOM_BYTES = 32;
const OK = 200;
const BAD_REQUEST = 400;
const enabled = process.env.IAM_PHASE4_TESTS === '1';

async function presentConsent(page: Page, role: string): Promise<void> {
  await page.getByText('Reports', { exact: true }).waitFor();
  await page.getByText(role, { exact: false }).waitFor();
  await tabTo(page.getByRole('button', { name: 'Allow' }));
  await page.keyboard.press('Enter');
}

async function readApprovals(
  fixture: Fixture,
  reader: Reader,
): Promise<(typeof authorizationEvents.$inferSelect)[]> {
  return reader
    .select()
    .from(authorizationEvents)
    .where(
      and(
        eq(authorizationEvents.clientId, fixture.north.clientId),
        eq(authorizationEvents.stage, 'authorization'),
      ),
    );
}

async function checkConsent(
  page: Page,
  fixture: Fixture,
  callback: string,
  reader: Reader,
): Promise<void> {
  const origin = new URL(callback).origin;
  await page.goto(new URL('/sign-in', origin).href);
  await tabTo(page.getByLabel('Email address'));
  await page.keyboard.insertText(fixture.email);
  await tabTo(page.getByLabel('Password', { exact: true }));
  await page.keyboard.insertText(fixture.password);
  await tabTo(page.getByRole('button', { name: 'Sign in' }));
  await page.keyboard.press('Enter');
  await presentConsent(page, 'reader');
  await page.waitForURL(`${callback}?**`);
  expect(await page.locator('body').textContent()).toContain(fixture.userId);

  const eventId: unknown = expect.any(String);
  const createdAt: unknown = expect.any(Date);
  const expected = {
    id: eventId,
    createdAt,
    clientId: fixture.north.clientId,
    organizationId: fixture.north.organizationId,
    userId: fixture.userId,
    outcome: 'approved',
    stage: 'authorization',
  };
  const first = await readApprovals(fixture, reader);
  expect(first).toEqual([expected]);

  await page.goto(new URL('/sign-in', origin).href);
  await page.waitForURL(`${callback}?**`);
  expect(await page.locator('body').textContent()).toContain(fixture.userId);

  const signIns = await reader
    .select({ entry: signInEvents.entry })
    .from(signInEvents)
    .where(eq(signInEvents.userId, fixture.userId));
  expect(signIns).toEqual([{ entry: 'web_form' }]);

  const reused = await readApprovals(fixture, reader);
  expect(reused).toEqual([expected, expected]);
  expect(new Set(reused.map(({ id }) => id)).size).toBe(reused.length);

  await assignAppRole({
    clientId: fixture.north.clientId,
    organizationId: fixture.north.organizationId,
    userId: fixture.userId,
    role: 'editor',
  });
  await page.goto(new URL('/sign-in', origin).href);
  await presentConsent(page, 'editor');
  await page.waitForURL(`${callback}?**`);
  expect(await page.locator('body').textContent()).toContain(fixture.userId);
}

async function checkAuthorization(page: Page, fixture: Fixture, callback: string): Promise<void> {
  const origin = new URL(callback).origin;
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const missingPkce = authorizationUrl(fixture.north, callback, verifier);
  missingPkce.searchParams.delete('code_challenge');
  missingPkce.searchParams.delete('code_challenge_method');

  const invalidCallback = authorizationUrl(fixture.north, callback, verifier);
  invalidCallback.searchParams.set('redirect_uri', 'https://unregistered.example/callback');

  const denied = authorizationUrl(fixture.south, callback, verifier);
  denied.searchParams.set('organization_id', fixture.north.organizationId);
  denied.searchParams.set('user_id', fixture.north.organizationId);

  await Promise.all(
    [missingPkce, invalidCallback, denied].map(async (url) => {
      const response = await page.request.get(url.href, { maxRedirects: 0 });
      const destination = new URL(new Headers(response.headers()).get('location') ?? '/', origin);

      expect(destination.searchParams.has('code')).toBe(false);
      expect(destination.hostname).not.toBe('unregistered.example');
      expect(response.status() >= BAD_REQUEST || destination.searchParams.has('error')).toBe(true);
    }),
  );
}

async function checkExchange(
  page: Page,
  fixture: Fixture,
  callback: string,
  reader: Reader,
): Promise<void> {
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const authorize = authorizationUrl(fixture.north, callback, verifier);
  const previous = await readApprovals(fixture, reader);
  const response = await page.request.get(authorize.href, { maxRedirects: 0 });
  const code = new URL(response.headers().location).searchParams.get('code');

  assert.ok(code);
  const approvals = await readApprovals(fixture, reader);
  expect(approvals.length - previous.length).toBe(ONE_APPROVAL);
  const accepted = await exchange(fixture.north, callback, code, verifier);
  expect(accepted.status).toBe(OK);
  const replay = await exchange(fixture.north, callback, code, verifier);
  expect(await replay.json()).toMatchObject({
    error: 'invalid_grant',
  });
  const invalid = await exchange(fixture.north, callback, 'invalid', verifier);
  expect(invalid.ok).toBe(false);

  const next = await page.request.get(authorize.href, { maxRedirects: 0 });
  const pendingCode = new URL(next.headers().location).searchParams.get('code');

  assert.ok(pendingCode);
  await revokeAppGrant({
    clientId: fixture.north.clientId,
    organizationId: fixture.north.organizationId,
    userId: fixture.userId,
  });
  const revoked = await exchange(fixture.north, callback, pendingCode, verifier);
  expect(await revoked.json()).toMatchObject({ error: 'invalid_grant' });

  const events = await reader
    .select()
    .from(authorizationEvents)
    .where(eq(authorizationEvents.userId, fixture.userId));

  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        userId: fixture.userId,
        clientId: fixture.south.clientId,
        organizationId: fixture.south.organizationId,
        stage: 'authorization',
        outcome: 'denied',
      }),
      expect.objectContaining({
        userId: fixture.userId,
        clientId: fixture.north.clientId,
        outcome: 'approved',
      }),
      expect.objectContaining({
        userId: fixture.userId,
        clientId: fixture.north.clientId,
        stage: 'exchange',
        outcome: 'denied',
      }),
    ]),
  );
}

test.skipIf(!enabled)(
  'Phase 4 issuer and reference app',
  async () => {
    initializeEnv();

    const env = useEnv();
    const origin = process.env.IAM_PHASE4_APP_ORIGIN;

    assert.equal(env.db.database, 'iam_phase4_test');
    assert.ok(origin);

    const callback = new URL('/callback', origin).href;
    const database = useDatabase();

    try {
      await verifySigningKeys(env.oidcIssuerUrl);

      const fixture = await seedOidc(callback);
      const reader = openAuditReader();
      const server = fileURLToPath(
        new URL('../../../../examples/reference-app/server.ts', import.meta.url),
      );
      const browser = await chromium.launch();
      const app = spawn(process.execPath, [server], {
        stdio: 'inherit',
        env: {
          ...serverEnvironment(),
          APP_ORIGIN: origin,
          CLIENT_ID: fixture.north.clientId,
          CLIENT_SECRET: fixture.north.clientSecret,
          PORT: process.env.IAM_PHASE4_APP_PORT,
        },
      });

      try {
        await expect
          .poll(
            async () => {
              const response = await fetch(origin);
              return response.status;
            },
            { timeout: TIMEOUT },
          )
          .toBe(OK);
        const page = await browser.newPage({ ignoreHTTPSErrors: true });

        await checkConsent(page, fixture, callback, reader);
        const exchangeReport = process.env.IAM_PHASE4_EXCHANGE_REPORT;
        if (exchangeReport) {
          await recordExchangeCapacity(page, fixture.north, callback, exchangeReport);
        }
        await checkAuthorization(page, fixture, callback);
        await checkExchange(page, fixture, callback, reader);
        await checkInstallationConsent(page, fixture, callback, reader);
      } finally {
        app.kill();
        await browser.close();
      }
    } finally {
      await database.$client.end();
    }
  },
  TIMEOUT,
);
