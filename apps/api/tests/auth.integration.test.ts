import type { useDatabase } from '@iam/database';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vite-plus/test';
import { createAuth } from '../../../packages/auth/src/utils/auth.ts';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';

const port = Number(process.env.AUTH_TEST_DB_PORT);
const origin = 'http://localhost:5173';
const apiUrl = 'http://localhost:3000';
const password = 'integration-test-password';
const unauthorized = 401;
const forbidden = 403;
const tooManyRequests = 429;
const success = 200;
const secretBytes = 32;

function connectDatabase(): ReturnType<typeof useDatabase> {
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

const database = connectDatabase();
const auth = createAuth(database, {
  secret: randomBytes(secretBytes).toString('hex'),
  url: apiUrl,
  webOrigin: origin,
});
const email = `${randomUUID()}@example.com`;

async function request(
  path: string,
  body: Record<string, string>,
  ip = '192.0.2.10',
  cookie = '',
): Promise<Response> {
  const response = await auth.handler(
    new Request(`${apiUrl}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        'x-forwarded-for': ip,
        cookie,
      },
      body: JSON.stringify(body),
    }),
  );
  return response;
}

describe.skipIf(!port)('Better Auth with disposable PostgreSQL', () => {
  afterAll(async () => {
    try {
      await database.$client`delete from iam.users where email = ${email}`;
      await database.$client`delete from iam.rate_limits where key like ${'%192.0.2.%'}`;
    } finally {
      await database.$client.end();
    }
  });

  test('registers, persists credentials, reads sessions, and revokes on sign-out', async () => {
    const registered = await request('sign-up/email', {
      name: 'Test User',
      email,
      password,
    });
    expect(registered.status).toBe(success);
    const identity = await database.query.users.findFirst({
      where: { email },
      with: {
        accounts: true,
        sessions: true,
      },
    });
    expect(identity?.id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u,
    );
    expect(identity?.accounts).toEqual([expect.objectContaining({ providerId: 'credential' })]);
    expect(identity?.sessions).toEqual([expect.objectContaining({ userId: identity?.id })]);
    const cookie = registered.headers
      .getSetCookie()
      .map((value) => {
        const [cookiePair] = value.split(';');
        return cookiePair;
      })
      .join('; ');
    expect(cookie).toContain('better-auth.session_token=');
    expect(registered.headers.get('set-cookie')).toContain('HttpOnly');
    const stored =
      await database.$client`select password from iam.accounts join iam.users on users.id = accounts.user_id where email = ${email}`;
    const [account] = stored;
    expect(account.password).toBeTypeOf('string');
    expect(account.password).not.toBe(password);
    const session = await auth.handler(
      new Request(`${apiUrl}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(await session.text()).toContain(email);
    const signedOut = await request('sign-out', {}, '192.0.2.11', cookie);
    expect(signedOut.status).toBe(success);
    const revoked = await auth.handler(
      new Request(`${apiUrl}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(await revoked.json()).toBeNull();
    const signedIn = await request('sign-in/email', { email, password }, '192.0.2.12');
    expect(signedIn.status).toBe(success);
    expect(signedIn.headers.get('set-cookie')).toContain('better-auth.session_token=');
  });

  test('rejects invalid credentials', async () => {
    const response = await request(
      'sign-in/email',
      {
        email: 'missing@example.com',
        password,
      },
      '192.0.2.13',
    );
    expect(response.status).toBe(unauthorized);
  });

  test('rejects untrusted origins', async () => {
    const response = await auth.handler(
      new Request(`${apiUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          origin: 'https://untrusted.example',
          'content-type': 'application/json',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({
          email,
          password,
          name: 'Test User',
        }),
      }),
    );
    expect(response.status).toBe(forbidden);
  });

  test('enforces shared database rate limits', async () => {
    const credentials = {
      email: 'missing@example.com',
      password,
    };
    await request('sign-in/email', credentials, '192.0.2.14');
    await request('sign-in/email', credentials, '192.0.2.14');
    await request('sign-in/email', credentials, '192.0.2.14');
    const limited = await request('sign-in/email', credentials, '192.0.2.14');
    expect(limited.status).toBe(tooManyRequests);
  });
});
