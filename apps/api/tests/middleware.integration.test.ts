import { useDatabase } from '@iam/database';
import { H3 } from 'nitro/h3';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import authHandler from '../server/api/auth/[...all].ts';
import authMiddleware from '../server/middleware/auth.ts';

const port = process.env.AUTH_TEST_DB_PORT;
const origin = 'http://localhost:3000';
const success = 200;
const unauthorized = 401;
const forbidden = 403;
const noContent = 204;
const email = `${randomUUID()}@example.com`;
const password = 'middleware-test-password';
const app = new H3()
  .use(authMiddleware)
  .all('/api/auth/**', authHandler)
  .post('/api/action', () => ({ ok: true }))
  .get('/api/authentication', () => ({ ok: true }))
  .get('/health', () => ({ ok: true }));

async function request(
  path: string,
  cookie = '',
  body: Record<string, string> | null = null,
  requestOrigin = origin,
): Promise<Response> {
  const incoming = new Request(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      origin: requestOrigin,
      cookie,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  return app.fetch(Object.assign(incoming, { context: { clientAddress: '192.0.2.21' } }));
}

async function expectPrivateSignup(response: Response): Promise<void> {
  expect(response.status).toBe(success);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({});
}

async function registerFixture(): Promise<void> {
  await expectPrivateSignup(
    await request('/api/auth/sign-up/email', '', {
      email,
      password,
      name: 'Middleware Test',
    }),
  );
  await expectPrivateSignup(
    await request('/api/auth/sign-up/email', '', {
      email,
      password: 'different-fixture-password',
      name: 'Different fixture name',
    }),
  );
}

async function verifyPrivateSignIn(): Promise<void> {
  const missingEmail = `${randomUUID()}@example.test`;
  const unverified = await request('/api/auth/sign-in/email', '', { email, password });
  const unknown = await request('/api/auth/sign-in/email', '', {
    email: missingEmail,
    password,
  });
  expect(unverified.status).toBe(unauthorized);
  expect(unknown.status).toBe(unauthorized);
  expect(unverified.headers.getSetCookie()).toEqual([]);
  expect(unknown.headers.getSetCookie()).toEqual([]);
  expect(await unverified.json()).toEqual(await unknown.json());
  await useDatabase().$client`update iam.users set email_verified = true where email = ${email}`;
}

async function signInFixture(): Promise<string> {
  const signedIn = await request('/api/auth/sign-in/email', '', { email, password });
  const id: unknown = expect.any(String);
  expect(signedIn.status).toBe(success);
  expect(await signedIn.json()).toEqual({
    redirect: false,
    user: {
      id,
      email,
      name: 'Middleware Test',
      emailVerified: true,
    },
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => {
      const [pair] = value.split(';');
      return pair;
    })
    .join('; ');
  expect(cookie).toContain('better-auth.session_token=');
  return cookie;
}

describe.skipIf(!port)('API authentication middleware', () => {
  beforeAll(() => {
    const environment = {
      APP_ENV: 'testing',
      AUTH_SECRET: 'middleware-test-secret-with-at-least-32-characters',
      AUTH_URL: origin,
      AUTH_WEB_ORIGIN: origin,
      DB_HOST: '127.0.0.1',
      DB_PORT: port,
      DB_USER: 'iam',
      DB_PASSWORD: 'disposable',
      DB_DATABASE: 'iam',
    };

    for (const [name, value] of Object.entries(environment)) {
      vi.stubEnv(name, value);
    }
  });

  afterAll(async () => {
    const database = useDatabase();

    try {
      await database.$client`delete from iam.users where email = ${email}`;
      await database.$client`delete from iam.rate_limits where key like ${'%192.0.2.21%'}`;
    } finally {
      await database.$client.end();
      vi.unstubAllEnvs();
    }
  });

  test.each(['/api/authentication', '/api/%61uthentication'])(
    'requires authentication for %s',
    async (path) => {
      const response = await request(path);
      expect(response.status).toBe(unauthorized);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    },
  );

  test('allows credentialed CORS and unauthenticated preflight', async () => {
    const response = await app.fetch(
      new Request('http://localhost:3000/api/action', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }),
    );
    expect(response.status).toBe(noContent);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    const rejected = await request('/api/auth/ok', '', null, 'https://untrusted.example');
    expect(rejected.status).toBe(forbidden);
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('keeps auth endpoints and routes outside /api public', async () => {
    const authHealth = await request('/api/auth/ok');
    expect(authHealth.status).toBe(success);
    const health = await request('/health');
    expect(health.status).toBe(success);
  });

  test('allows authenticated requests and rejects a revoked session', async () => {
    await registerFixture();
    await verifyPrivateSignIn();
    const cookie = await signInFixture();
    const database = useDatabase();
    await database.$client`update iam.sessions set expires_at = now() + interval '1 day' where user_id in (select id from iam.users where email = ${email})`;
    const protectedResponse = await request('/api/authentication', cookie);
    expect(protectedResponse.status).toBe(success);
    expect(protectedResponse.headers.get('set-cookie')).toContain('better-auth.session_token=');
    const session = await request('/api/auth/get-session', cookie);
    expect(session.status).toBe(success);
    expect(await session.text()).toContain(email);
    const mutation = await request('/api/action', cookie, {});
    expect(mutation.status).toBe(success);
    const untrusted = await request('/api/action', cookie, {}, 'https://untrusted.example');
    expect(untrusted.status).toBe(forbidden);
    const missingOrigin = await request('/api/action', cookie, {}, '');
    expect(missingOrigin.status).toBe(forbidden);
    const signedOut = await request('/api/auth/sign-out', cookie, {});
    expect(signedOut.status).toBe(success);
    const revoked = await request('/api/authentication', cookie);
    expect(revoked.status).toBe(unauthorized);
  });
});
