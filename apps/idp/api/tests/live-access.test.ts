import type { Page } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { assignAppRole, revokeAppGrant } from '../server/services/registration.service.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { startCluster } from './fixtures/live-processes.ts';
import { authorizationUrl, exchange } from './fixtures/oidc-protocol.ts';
import { seedOidc } from './fixtures/oidc.ts';

type Fixture = Awaited<ReturnType<typeof seedOidc>>;
type Cluster = Awaited<ReturnType<typeof startCluster>>;
type Client = { clientId: string; clientSecret: string };

const BAD_REQUEST = 400;
const OK = 200;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const UNAVAILABLE = 503;
const RANDOM_BYTES = 32;
const MILLISECONDS_PER_SECOND = 1000;
const TIMEOUT = 90_000;

const enabled = process.env.IAM_PHASE5_TESTS === '1';
const tokensSchema = valibot.object({
  access_token: valibot.string(),
  expires_in: valibot.number(),
});

const accessSchema = valibot.object({
  active: valibot.boolean(),
  permissions: valibot.optional(valibot.array(valibot.string())),
});

async function issueToken(
  page: Page,
  client: Client,
  callback: string,
): Promise<{ token: string; expiresAt: number }> {
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const issuedAt = Date.now();
  await page.goto(authorizationUrl(client, callback, verifier).href);
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(`${callback}?**`);

  const code = new URL(page.url()).searchParams.get('code');
  assert.ok(code);

  const response = await exchange(client, callback, code, verifier);
  expect(response.status).toBe(OK);

  const tokens = valibot.parse(tokensSchema, await response.json());

  return {
    token: tokens.access_token,
    expiresAt: issuedAt + tokens.expires_in * MILLISECONDS_PER_SECOND,
  };
}

async function introspect(
  issuer: URL,
  client: Client,
  token: string,
): Promise<valibot.InferOutput<typeof accessSchema>> {
  const credentials = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
  const response = await fetch(new URL('/api/v1/auth/oauth2/introspect', issuer), {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}` },
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    }),
  });

  expect(response.status).toBe(OK);
  return valibot.parse(accessSchema, await response.json());
}

async function checkClientAuthentication(
  issuer: URL,
  client: Client,
  token: string,
): Promise<void> {
  const credentials = Buffer.from(`${client.clientId}:wrong-secret`).toString('base64');
  const invalid = new Headers({ authorization: `Basic ${credentials}` });
  await Promise.all(
    [new Headers(), invalid].map(async (headers) => {
      const response = await fetch(new URL('/api/v1/auth/oauth2/introspect', issuer), {
        method: 'POST',
        headers,
        body: new URLSearchParams({ token }),
      });

      expect([BAD_REQUEST, UNAUTHORIZED]).toContain(response.status);
      expect(await response.json()).toHaveProperty('error');
    }),
  );
}

async function expectStatus(page: Page, url: string, status: number): Promise<void> {
  const response = await page.request.get(url);
  expect(response.status()).toBe(status);
}

async function login(
  page: Page,
  origin: string,
  callback: string,
  credentials?: Fixture,
): Promise<void> {
  await page.goto(new URL('/sign-in', origin).href);
  if (credentials) {
    await page.getByLabel('Email address').fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(`${callback}?**`);
}

async function checkAccess(
  page: Page,
  cluster: Cluster,
  fixture: Fixture,
  resource: string,
): Promise<void> {
  const callback = new URL('/callback', cluster.appOrigin).href;
  const assignment = {
    userId: fixture.userId,
    clientId: fixture.north.clientId,
    organizationId: fixture.north.organizationId,
  };

  await expectStatus(page, resource, OK);
  await expectStatus(page, new URL('/reports/another-user', cluster.appOrigin).href, FORBIDDEN);

  await assignAppRole({
    ...assignment,
    role: 'auditor',
  });
  await expectStatus(page, resource, UNAUTHORIZED);
  await login(page, cluster.appOrigin, callback);
  await expectStatus(page, resource, FORBIDDEN);
  await assignAppRole({
    ...assignment,
    role: 'reader',
  });
  await login(page, cluster.appOrigin, callback);
  await expectStatus(page, resource, OK);

  cluster.setIntrospectionAvailable(false);
  await expectStatus(page, resource, UNAVAILABLE);
  cluster.setIntrospectionAvailable(true);
  await expectStatus(page, resource, OK);
}

async function checkRevocation(
  page: Page,
  cluster: Cluster,
  fixture: Fixture,
  issuer: URL,
): Promise<void> {
  const resource = new URL(`/reports/${fixture.userId}`, cluster.appOrigin).href;
  const callback = new URL('/callback', cluster.appOrigin).href;
  const assignment = {
    userId: fixture.userId,
    clientId: fixture.north.clientId,
    organizationId: fixture.north.organizationId,
  };

  await assignAppRole({
    userId: fixture.userId,
    clientId: fixture.south.clientId,
    organizationId: fixture.south.organizationId,
    role: 'reader',
  });
  const south = await issueToken(page, fixture.south, callback);
  await checkClientAuthentication(issuer, fixture.south, south.token);
  expect(await introspect(issuer, fixture.north, south.token)).toEqual({ active: false });
  await revokeAppGrant(assignment);
  await expectStatus(page, resource, UNAUTHORIZED);
  expect(await introspect(issuer, fixture.south, south.token)).toMatchObject({
    active: true,
    permissions: ['reports.read'],
  });

  await assignAppRole({
    ...assignment,
    role: 'reader',
  });
  await login(page, cluster.appOrigin, callback);
  await expectStatus(page, resource, OK);
  await page.goto(new URL('/sign-out', issuer).href);
  await page.getByRole('button', { name: 'Sign out of IAM' }).click();
  await page.getByText('You have signed out of IAM.').waitFor();
  await expectStatus(page, resource, UNAUTHORIZED);
  expect(await introspect(issuer, fixture.south, south.token)).toEqual({ active: false });
  expect(south.expiresAt).toBeGreaterThan(Date.now());
}

test.skipIf(!enabled)(
  'enforces live grants and IAM sign-out across IdP replicas',
  async ({ onTestFinished }) => {
    initializeEnv();
    const env = useEnv();
    assert.equal(env.db.database, 'iam_phase5_test');

    const issuer = new URL(env.oidcIssuerUrl);
    const database = useDatabase();
    onTestFinished(async () => database.$client.end());
    const cluster = await startCluster(issuer);
    onTestFinished(cluster.close);
    const callback = new URL('/callback', cluster.appOrigin).href;
    const fixture = await seedOidc(callback);
    await cluster.startApp(fixture.north);

    const browser = await chromium.launch();
    onTestFinished(async () => browser.close());
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const resource = new URL(`/reports/${fixture.userId}`, cluster.appOrigin).href;
    await login(page, cluster.appOrigin, callback, fixture);
    await checkAccess(page, cluster, fixture, resource);
    await checkRevocation(page, cluster, fixture, issuer);
  },
  TIMEOUT,
);
