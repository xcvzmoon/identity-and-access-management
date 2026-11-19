import type { Page } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { authorizationEvents } from '../server/database/schema.ts';
import { assignAppRole, revokeAppGrant } from '../server/services/registration.service.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { checkInstallationConsent } from './fixtures/oidc-consent.ts';
import { authorizationUrl, exchange } from './fixtures/oidc-protocol.ts';
import { seedOidc } from './fixtures/oidc.ts';
import { verifySigningKeys } from './fixtures/signing-keys.ts';

type Fixture = Awaited<ReturnType<typeof seedOidc>>;

const TIMEOUT = 45_000;
const RANDOM_BYTES = 32;
const OK = 200;
const BAD_REQUEST = 400;
const enabled = process.env.IAM_PHASE4_TESTS === '1';

async function presentConsent(page: Page, role: string): Promise<void> {
  await page.getByText('Reports', { exact: true }).waitFor();
  await page.getByText(role, { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Allow' }).click();
}

async function checkConsent(page: Page, fixture: Fixture, callback: string): Promise<void> {
  const origin = new URL(callback).origin;
  await page.goto(new URL('/sign-in', origin).href);
  await page.getByLabel('Email address').fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await presentConsent(page, 'reader');
  await page.waitForURL(`${callback}?**`);
  expect(await page.locator('body').textContent()).toContain(fixture.userId);

  await page.goto(new URL('/sign-in', origin).href);
  await page.waitForURL(`${callback}?**`);
  expect(await page.locator('body').textContent()).toContain(fixture.userId);

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

  await Promise.all(
    [missingPkce, invalidCallback, authorizationUrl(fixture.south, callback, verifier)].map(
      async (url) => {
        const response = await page.request.get(url.href, { maxRedirects: 0 });
        const destination = new URL(new Headers(response.headers()).get('location') ?? '/', origin);

        expect(destination.searchParams.has('code')).toBe(false);
        expect(destination.hostname).not.toBe('unregistered.example');
        expect(response.status() >= BAD_REQUEST || destination.searchParams.has('error')).toBe(
          true,
        );
      },
    ),
  );
}

async function checkExchange(page: Page, fixture: Fixture, callback: string): Promise<void> {
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const authorize = authorizationUrl(fixture.north, callback, verifier);
  const response = await page.request.get(authorize.href, { maxRedirects: 0 });
  const code = new URL(response.headers().location).searchParams.get('code');

  assert.ok(code);
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

  const database = useDatabase();
  const events = await database.select().from(authorizationEvents);

  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        userId: fixture.userId,
        clientId: fixture.south.clientId,
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
      const server = fileURLToPath(
        new URL('../../../../examples/reference-app/server.ts', import.meta.url),
      );
      const browser = await chromium.launch();
      const app = spawn(process.execPath, [server], {
        stdio: 'inherit',
        env: {
          ...process.env,
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

        await checkConsent(page, fixture, callback);
        await checkAuthorization(page, fixture, callback);
        await checkExchange(page, fixture, callback);
        await checkInstallationConsent(page, fixture, callback);
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
