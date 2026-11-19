import type { Page } from 'playwright';
import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import postgres from 'postgres';
import { expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { oauthClients } from '../server/database/schema.ts';
import { assignAppRole, provisionClient } from '../server/services/registration.service.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { startCluster } from './fixtures/live-processes.ts';
import { installReports, seedAccount } from './fixtures/oidc.ts';

type Cluster = Awaited<ReturnType<typeof startCluster>>;
type Account = Awaited<ReturnType<typeof seedAccount>>;

const TIMEOUT = 90_000;
const UNAUTHORIZED = 401;
const SEE_OTHER = 303;
const BAD_REQUEST = 400;

const enabled = process.env.IAM_PHASE6_TESTS === '1';

async function checkRejectedLogin(page: Page, origin: string): Promise<void> {
  const login = new URL('/api/v1/login', origin);
  const pending = await page.request.get(login.href, { maxRedirects: 0 });
  const location = pending.headers().location;
  assert.ok(location);

  const authorization = new URL(location);
  const state = authorization.searchParams.get('state');
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorization.searchParams.get('nonce')).toBeTruthy();
  assert.ok(state);

  const callback = new URL('/api/v1/callback', origin);
  callback.searchParams.set('state', state);
  callback.searchParams.set('code', 'invalid-fixture-code');
  callback.searchParams.set('iss', authorization.origin);
  const canceled = await page.request.get(callback.href, { maxRedirects: 0 });
  expect(canceled.status()).toBe(BAD_REQUEST);

  login.searchParams.set('returnTo', 'https://example.invalid/');
  const refused = await page.request.get(login.href, { maxRedirects: 0 });
  expect(refused.status()).toBe(BAD_REQUEST);

  const session = await page.request.get(new URL('/api/v1/session', origin).href);
  expect(session.status()).toBe(UNAUTHORIZED);
}

async function openAccount(page: Page, cluster: Cluster, account: Account): Promise<void> {
  const requested = new URL('/account?from=fixture', cluster.consoleOrigin);
  const callback = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/v1/callback',
  );

  await page.goto(requested.href);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(requested.href);
  await page.getByText(account.email, { exact: true }).waitFor();

  const identity = await page.request.get(new URL('/api/v1/session', cluster.consoleOrigin).href);
  expect(await identity.json()).toMatchObject({
    user: {
      sub: account.userId,
      email: account.email,
      name: 'OIDC fixture',
    },
  });
  const cookies = await page.context().cookies(cluster.consoleOrigin);
  expect(cookies).toContainEqual(
    expect.objectContaining({
      name: '__Host-iam-console-session',
      domain: 'console.localhost',
      httpOnly: true,
      secure: true,
      path: '/',
    }),
  );

  const completed = await callback;
  const duplicate = await page.request.get(completed.url(), { maxRedirects: 0 });
  expect(duplicate.status()).toBe(BAD_REQUEST);
}

async function verifyReports(page: Page, cluster: Cluster, account: Account): Promise<void> {
  const callback = new URL('/callback', cluster.appOrigin);
  const installation = await installReports(account.headers, account.userId, callback.href);
  await assignAppRole({
    userId: account.userId,
    clientId: installation.clientId,
    organizationId: installation.organizationId,
    role: 'reader',
  });
  await cluster.startApp(installation);
  await page.goto(new URL('/sign-in', cluster.appOrigin).href);
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(`${callback.href}?**`);

  const report = await page.request.get(
    new URL(`/reports/${account.userId}`, cluster.appOrigin).href,
  );
  expect(report.ok()).toBe(true);
}

async function checkExpiry(page: Page, origin: string, account: Account): Promise<void> {
  const env = useEnv();
  const client = postgres({
    ...env.db,
    user: 'iam_console_runtime',
    password: process.env.IAM_PHASE6_CONSOLE_DB_PASSWORD,
  });

  try {
    await client`UPDATE iam_console.sessions SET expires_at = now() WHERE sub = ${account.userId}`;
  } finally {
    await client.end();
  }

  const response = await page.request.get(new URL('/api/v1/session', origin).href);
  expect(response.status()).toBe(UNAUTHORIZED);
  await page.goto(new URL('/account', origin).href);
  await page.getByText(account.email, { exact: true }).waitFor();
}

async function checkSignOut(page: Page, cluster: Cluster, account: Account): Promise<void> {
  const env = useEnv();
  const [logout] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/sign-out'),
    page.getByRole('button', { name: 'Sign out of console' }).click(),
  ]);
  expect(logout.status()).toBe(SEE_OTHER);
  await page.waitForURL(new URL('/signed-out', cluster.consoleOrigin).href);
  const session = new URL('/api/v1/session', cluster.consoleOrigin);
  const localSession = await page.request.get(session.href);
  expect(localSession.status()).toBe(UNAUTHORIZED);
  await verifyReports(page, cluster, account);
  await page.goto(new URL('/account', cluster.consoleOrigin).href);
  await page.getByRole('button', { name: 'Sign out of IAM' }).click();
  await page.waitForURL(new URL('/sign-out', env.oidcIssuerUrl).href);
  await page.getByRole('button', { name: 'Sign out of IAM' }).click();
  await page.getByText('You have signed out of IAM.').waitFor();
  const finalSession = await page.request.get(session.href);
  expect(finalSession.status()).toBe(UNAUTHORIZED);

  const report = await page.request.get(
    new URL(`/reports/${account.userId}`, cluster.appOrigin).href,
  );
  expect(report.status()).toBe(UNAUTHORIZED);
  await page.goto(new URL('/account', cluster.consoleOrigin).href);
  await page.getByLabel('Password', { exact: true }).waitFor();
}

test.skipIf(!enabled)(
  'opens an independent console session for a verified account',
  async ({ onTestFinished }) => {
    initializeEnv();
    const env = useEnv();
    assert.equal(env.db.database, 'iam_phase6_test');

    const database = useDatabase();
    const cluster = await startCluster(new URL(env.oidcIssuerUrl));
    onTestFinished(cluster.close);
    const account = await seedAccount();
    const registration = await provisionClient(account.headers, {
      kind: 'console',
      name: 'IAM console',
      redirectUris: [new URL('/api/v1/callback', cluster.consoleOrigin).href],
    });
    onTestFinished(async () => {
      await database.delete(oauthClients).where(eq(oauthClients.clientId, registration.clientId));
      await database.$client.end();
    });
    await cluster.startConsole(registration);

    const browser = await chromium.launch();
    onTestFinished(async () => browser.close());
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await checkRejectedLogin(page, cluster.consoleOrigin);
    await openAccount(page, cluster, account);
    await checkExpiry(page, cluster.consoleOrigin, account);
    await checkSignOut(page, cluster, account);
  },
  TIMEOUT,
);
