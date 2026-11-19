import type { Page } from 'playwright';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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

const HEALTHY = 0;
const CRITICAL = 2;
const PRIVATE_FILE = 0o600;
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

async function probeIntrospection(endpoint: URL, netrc: string): Promise<number> {
  const script = fileURLToPath(
    new URL('../../../../deploy/check-introspection.sh', import.meta.url),
  );
  try {
    await promisify(execFile)('sh', [script, endpoint.href, netrc], {
      env: {
        ...process.env,
        CURL_CA_BUNDLE: process.env.NODE_EXTRA_CA_CERTS,
      },
    });
    return HEALTHY;
  } catch (error) {
    if (valibot.is(valibot.object({ code: valibot.literal(CRITICAL) }), error)) {
      return CRITICAL;
    }
    throw error;
  }
}

async function checkIntrospectionRecovery(
  page: Page,
  cluster: Cluster,
  client: Client,
  resource: string,
): Promise<void> {
  const env = useEnv();
  const endpoint = new URL('/api/v1/auth/oauth2/introspect', env.oidcIssuerUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'iam-probe-'));
  const netrc = path.join(directory, 'netrc');

  try {
    await writeFile(
      netrc,
      `machine ${endpoint.hostname} login ${client.clientId} password ${client.clientSecret}\n`,
      { mode: PRIVATE_FILE },
    );
    expect(await probeIntrospection(endpoint, netrc)).toBe(HEALTHY);
    cluster.setIntrospectionAvailable(false);
    expect(await probeIntrospection(endpoint, netrc)).toBe(CRITICAL);
    await expectStatus(page, resource, UNAVAILABLE);
    cluster.setIntrospectionAvailable(true);
    expect(await probeIntrospection(endpoint, netrc)).toBe(HEALTHY);
    await expectStatus(page, resource, OK);
  } finally {
    cluster.setIntrospectionAvailable(true);
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
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

  await checkIntrospectionRecovery(page, cluster, fixture.north, resource);
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
