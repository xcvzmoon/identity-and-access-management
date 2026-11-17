import { randomUUID } from 'node:crypto';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';

const webUrl = process.env.AUTH_SSR_TEST_URL ?? 'http://localhost:5173';
const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const success = 200;
const redirect = 302;
const notFound = 404;
const unauthorized = 401;
const forbidden = 403;
const password = 'ssr-test-password';
const payloadSchema = valibot.object({ token: valibot.string() });

async function submitCredentials(
  path: '/api/signin' | '/api/signup',
  body: { email: string; password: string; name?: string },
  origin: string = webUrl,
): Promise<Response> {
  return fetch(`${webUrl}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function readAuthCookies(response: Response): Promise<string> {
  expect(response.status).toBe(success);
  expect(await response.json()).toEqual({});
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(';').shift())
    .join('; ');
  expect(cookies).toContain('better-auth.session_token=');
  expect(cookies).toContain('nuxt-auth-session=');
  return cookies;
}

async function verifyWebSession(cookie: string, email: string, token: string): Promise<void> {
  const session = await fetch(`${webUrl}/api/_auth/session`, {
    headers: { cookie },
  });
  expect(session.status).toBe(success);
  const sessionBody = await session.text();
  expect(sessionBody).toContain(email);
  expect(sessionBody).not.toContain(token);
}

async function expectRevokedWebSession(cookie: string): Promise<void> {
  const session = await fetch(`${webUrl}/api/_auth/session`, {
    headers: { cookie },
  });
  expect(session.status).toBe(unauthorized);
}

async function verifySignOut(cookie: string): Promise<void> {
  const signedOut = await fetch(`${webUrl}/api/signout`, {
    method: 'POST',
    headers: {
      cookie,
      origin: webUrl,
    },
  });
  expect(signedOut.status).toBe(success);
  const cookies = signedOut.headers.getSetCookie();
  expect(cookies).toEqual(
    expect.arrayContaining([
      expect.stringContaining('nuxt-auth-session=;'),
      expect.stringContaining('better-auth.session_token=;'),
    ]),
  );
}

async function verifySignIn(email: string): Promise<void> {
  const credentials = { email, password };
  const foreignOrigin = await submitCredentials(
    '/api/signin',
    credentials,
    'https://other.example',
  );
  expect(foreignOrigin.status).toBe(forbidden);
  const invalidCredentials = await submitCredentials('/api/signin', {
    email,
    password: 'incorrect-password',
  });
  expect(invalidCredentials.status).toBe(unauthorized);
  expect(invalidCredentials.headers.getSetCookie()).toEqual([]);
  const signedIn = await submitCredentials('/api/signin', credentials);
  const cookie = await readAuthCookies(signedIn);
  const account = await fetch(`${webUrl}/account`, { headers: { cookie } });
  expect(account.status).toBe(success);
  expect(await account.text()).toContain(email);
}

test.skipIf(!process.env.AUTH_SSR_TEST_URL || !databasePort)(
  'SSR resolves API sessions, forwards renewal cookies, and protects rendered pages',
  async () => {
    const email = `${randomUUID()}@example.com`;
    const name = 'SSR Auth Test';
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    try {
      const registered = await submitCredentials('/api/signup', {
        email,
        name,
        password,
      });
      const cookie = await readAuthCookies(registered);
      const [sessionRow] =
        await database.$client`update iam.sessions set expires_at = now() + interval '1 day' where user_id in (select id from iam.users where email = ${email}) returning token`;
      const payload = valibot.parse(payloadSchema, sessionRow);
      const account = await fetch(`${webUrl}/account`, {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(account.status).toBe(success);
      const html = await account.text();
      expect(html).toContain(`Welcome, ${name}`);
      expect(html).toContain(email);
      expect(html).not.toContain(payload.token);
      expect(account.headers.get('set-cookie')).toContain('better-auth.session_token=');
      expect(account.headers.get('cache-control')).toContain('no-store');
      await verifyWebSession(cookie, email, payload.token);
      const signIn = await fetch(`${webUrl}/signin`, {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(signIn.status).toBe(redirect);
      expect(signIn.headers.get('location')).toBe('/account');
      await verifySignOut(cookie);
      await expectRevokedWebSession(cookie);
      const revoked = await fetch(`${webUrl}/account`, {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(revoked.status).toBe(redirect);
      expect(revoked.headers.get('location')).toContain('/signin');
      await verifySignIn(email);
    } finally {
      try {
        await database.$client`delete from iam.users where email = ${email}`;
      } finally {
        await database.$client.end();
      }
    }
  },
);

test.skipIf(!process.env.AUTH_SSR_TEST_URL || !databasePort)(
  'SSR redirects guests and exposes no custom session endpoint',
  async () => {
    const anonymous = await fetch(`${webUrl}/account`, { redirect: 'manual' });
    expect(anonymous.status).toBe(redirect);
    expect(anonymous.headers.get('location')).toContain('/signin');
    const signIn = await fetch(`${webUrl}/signin`);
    expect(signIn.status).toBe(success);
    expect(await signIn.text()).toContain('Sign in');
    const signUp = await fetch(`${webUrl}/signup`);
    expect(signUp.status).toBe(success);
    expect(await signUp.text()).toContain('Sign up');
    const localSession = await fetch(`${webUrl}/api/session`);
    expect(localSession.status).toBe(notFound);
    const localSignUp = await fetch(`${webUrl}/api/auth/sign-up/email`, { method: 'POST' });
    expect(localSignUp.status).toBe(notFound);
  },
);
