import type { Auth } from '../src/utils/auth.ts';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../database/src/utils/client.ts';
import { createAuth } from '../src/utils/auth.ts';

const run = promisify(execFile);
const port = Number(process.env.AUTH_TEST_DB_PORT);
const enabled = process.env.AUTH_SIGNING_KEY_ROTATION_TEST === 'true';
const issuer = 'http://localhost:5173';
const secretBytes = 32;
const rotationTimeoutMs = 30_000;
const accountId = 'fixture-user';
const audience = issuer;
const signingKeyScript = fileURLToPath(new URL('../scripts/signing-keys.ts', import.meta.url));
const keyIdSchema = valibot.pipe(valibot.string(), valibot.uuid());
const jwksSchema = valibot.object({ keys: valibot.array(valibot.object({ kid: keyIdSchema })) });
const tokenHeaderSchema = valibot.object({ kid: keyIdSchema });

function openFixtureDatabase(): ReturnType<typeof createDatabase> {
  return createDatabase({
    host: '127.0.0.1',
    port,
    user: 'iam',
    password: 'disposable',
    database: 'iam',
    ssl: false,
    logger: false,
  });
}

async function runKeyCommand(secret: string, args: string[]): Promise<string> {
  const result = await run('vpx', [signingKeyScript, ...args], {
    env: {
      ...process.env,
      APP_ENV: 'testing',
      AUTH_URL: issuer,
      AUTH_WEB_ORIGIN: issuer,
      AUTH_SECRET: secret,
      DB_HOST: '127.0.0.1',
      DB_PORT: String(port),
      DB_USER: 'iam',
      DB_PASSWORD: 'disposable',
      DB_DATABASE: 'iam',
      DB_SSL: 'false',
    },
  });

  return valibot.parse(keyIdSchema, result.stdout.trim());
}

async function issueToken(auth: Auth): Promise<{ token: string; kid: string }> {
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        sub: accountId,
        aud: audience,
      },
    },
  });
  const [header] = token.split('.');
  const { kid } = valibot.parse(
    tokenHeaderSchema,
    JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
  );

  return { token, kid };
}

async function publishedKeyIds(auth: Auth): Promise<string[]> {
  const response = await auth.handler(new Request(`${issuer}/api/auth/jwks`));
  expect(response.ok).toBe(true);
  return valibot
    .parse(jwksSchema, await response.json())
    .keys.map(({ kid }) => kid)
    .toSorted();
}

async function expectValidToken(auth: Auth, token: string): Promise<void> {
  const verified = await auth.api.verifyJWT({
    body: {
      token,
      issuer,
    },
  });
  expect(verified.payload).toMatchObject({
    sub: accountId,
    aud: audience,
  });
}

async function expectSigningKey(auth: Auth, keyId: string): Promise<void> {
  const issued = await issueToken(auth);
  expect(issued.kid).toBe(keyId);
}

async function verifyRotation(primary: Auth, secondary: Auth, secret: string): Promise<void> {
  const original = await issueToken(primary);
  await expect(
    runKeyCommand(randomBytes(secretBytes).toString('hex'), ['stage', original.kid]),
  ).rejects.toThrow('SIGNING_KEY_SECRET_MISMATCH');
  const replacementId = await runKeyCommand(secret, ['stage', original.kid]);
  const published = [original.kid, replacementId].toSorted();
  expect(await publishedKeyIds(primary)).toEqual(published);
  expect(await publishedKeyIds(secondary)).toEqual(published);
  await expectSigningKey(secondary, original.kid);

  await runKeyCommand(secret, ['activate', original.kid, replacementId]);
  const replacement = await issueToken(secondary);
  expect(replacement.kid).toBe(replacementId);
  await expectSigningKey(primary, replacementId);
  await expectValidToken(secondary, original.token);
  await expect(runKeyCommand(secret, ['activate', original.kid, replacementId])).rejects.toThrow(
    'SIGNING_KEY_ACTIVE_MISMATCH',
  );

  await runKeyCommand(secret, ['activate', replacementId, original.kid]);
  await expectSigningKey(primary, original.kid);
  await expectSigningKey(secondary, original.kid);
  expect(await publishedKeyIds(primary)).toEqual(published);
  await expectValidToken(primary, replacement.token);
}

test.skipIf(!enabled || !port)(
  'prepublishes, activates, and rolls back a signing key across pools',
  async () => {
    const primaryDatabase = openFixtureDatabase();
    const secondaryDatabase = openFixtureDatabase();
    const options = {
      secret: randomBytes(secretBytes).toString('hex'),
      url: issuer,
      webOrigin: issuer,
    };

    try {
      expect(await primaryDatabase.$client`select id from iam.jwks`).toEqual([]);
      await verifyRotation(
        createAuth(primaryDatabase, options),
        createAuth(secondaryDatabase, options),
        options.secret,
      );
    } finally {
      await Promise.all([primaryDatabase.$client.end(), secondaryDatabase.$client.end()]);
    }
  },
  rotationTimeoutMs,
);
