import { and, eq, sql } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:http2';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { appGrants, memberships, sessions } from '../server/database/schema.ts';
import { assignAppRole, provisionClient } from '../server/services/registration.service.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { authorizationUrl } from './fixtures/oidc-protocol.ts';
import { installReports, seedAccount } from './fixtures/oidc.ts';

type Client = { clientId: string; clientSecret: string };

const VERIFIER_BYTES = 32;
const SUCCESS = 0;
const FAILURE = 1;
const TIMEOUT = 60_000;

function rotate(cookie: string, clientId: string, operators: string): SpawnSyncReturns<string> {
  return spawnSync('vpx', ['apps/idp/api/scripts/rotate-client-secret.ts', clientId], {
    input: cookie,
    encoding: 'utf8',
    env: {
      ...process.env,
      OPERATOR_USER_IDS: operators,
    },
  });
}

async function issueConsoleToken(
  client: Client,
  headers: Headers,
  callback: string,
): Promise<string> {
  const auth = useAuth();
  const env = useEnv();
  const verifier = randomBytes(VERIFIER_BYTES).toString('base64url');
  const authorization = await auth.handler(
    new Request(authorizationUrl(client, callback, verifier), { headers }),
  );
  const location = authorization.headers.get('location');
  assert.ok(location);
  const code = new URL(location).searchParams.get('code');
  assert.ok(code);
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
  const exchange = await auth.handler(
    new Request(new URL('/api/v1/auth/oauth2/token', env.oidcIssuerUrl), {
      method: 'POST',
      headers: { authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: callback,
        code,
        code_verifier: verifier,
      }),
    }),
  );
  const tokens = valibot.parse(
    valibot.object({ access_token: valibot.string() }),
    await exchange.json(),
  );
  return tokens.access_token;
}

async function introspect(clientId: string, secret: string, token: string): Promise<Response> {
  const env = useEnv();
  const auth = useAuth();
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await auth.handler(
    new Request(new URL('/api/v1/auth/oauth2/introspect', env.oidcIssuerUrl), {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }),
    }),
  );
  return response;
}

async function checkCutoff(
  client: Client,
  cookie: string,
  operators: string,
  token: string,
): Promise<void> {
  const before = await introspect(client.clientId, client.clientSecret, token);
  expect(before.status).toBe(constants.HTTP_STATUS_OK);
  const expected = { active: client.clientId === 'iam-console' };
  expect(await before.json()).toMatchObject(expected);
  const rotated = rotate(cookie, client.clientId, operators);
  expect(rotated.status).toBe(SUCCESS);
  const after = await introspect(client.clientId, rotated.stdout, token);
  expect(after.status).toBe(constants.HTTP_STATUS_OK);
  expect(await after.json()).toMatchObject(expected);
  const retired = await introspect(client.clientId, client.clientSecret, token);
  expect(retired.status).toBe(constants.HTTP_STATUS_UNAUTHORIZED);
}

test.skipIf(process.env.IAM_ROTATION_TESTS !== '1')(
  'rotates managed client secrets at immediate cutoff',
  async () => {
    initializeEnv();
    const env = useEnv();
    assert.equal(env.db.database, 'iam_rotation_test');
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.db.host));
    const database = useDatabase();

    try {
      const account = await seedAccount();
      const cookie = account.headers.get('cookie');
      assert.ok(cookie);
      const callback = 'https://fixture.example.test/callback';
      const consoleClient = await provisionClient(account.headers, {
        kind: 'console',
        name: 'IAM console',
        redirectUris: [callback],
      });
      const installation = await installReports(account.headers, account.userId, callback);
      const assignment = {
        clientId: installation.clientId,
        organizationId: installation.organizationId,
        userId: account.userId,
        role: 'reader',
      };
      await assignAppRole(assignment);
      expect(rotate(cookie, consoleClient.clientId, account.userId).status).toBe(FAILURE);
      await database
        .update(sessions)
        .set({ passkeyVerifiedAt: sql`now()` })
        .where(eq(sessions.userId, account.userId));
      expect(rotate(cookie, consoleClient.clientId, '').status).toBe(FAILURE);
      expect(rotate(cookie, installation.clientId, account.userId).status).toBe(FAILURE);
      await database
        .update(memberships)
        .set({ role: 'owner' })
        .where(
          and(
            eq(memberships.organizationId, installation.organizationId),
            eq(memberships.userId, account.userId),
          ),
        );

      const token = await issueConsoleToken(consoleClient, account.headers, callback);
      await checkCutoff(consoleClient, cookie, account.userId, token);
      await checkCutoff(installation, cookie, '', 'unused-fixture-token');

      const grants = await database
        .select({ role: appGrants.role })
        .from(appGrants)
        .where(
          and(eq(appGrants.clientId, installation.clientId), eq(appGrants.userId, account.userId)),
        );
      expect(grants).toEqual([{ role: 'reader' }]);
    } finally {
      await database.$client.end();
    }
  },
  TIMEOUT,
);
