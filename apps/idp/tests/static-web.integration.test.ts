import { randomUUID } from 'node:crypto';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createAuth } from '../../../packages/auth/src/utils/auth.ts';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';

const webUrl = process.env.AUTH_WEB_TEST_URL ?? 'http://localhost:5173';
const idpUrl = process.env.AUTH_IDP_TEST_URL ?? 'http://localhost:5176';
const apiUrl = process.env.AUTH_API_TEST_URL;
const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const success = 200;
const seeOther = 303;
const notFound = 404;
const unauthorized = 401;
const forbidden = 403;
const password = 'static-web-test-password';
const payloadSchema = valibot.object({ token: valibot.string() });

function expectSensitivePageHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('content-security-policy')).toBe(
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

async function submitCredentials(
  path: '/api/signin' | '/api/signup',
  body: { email: string; password?: string; name?: string },
  origin: string = idpUrl,
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
  expect(cookies).not.toContain('nuxt-auth-session=');
  return cookies;
}

async function verifyWebSession(cookie: string, email: string, token: string): Promise<void> {
  const session = await fetch(`${webUrl}/api/auth/get-session`, {
    headers: {
      cookie,
      origin: idpUrl,
    },
  });
  expect(session.status).toBe(success);
  expect(session.headers.get('access-control-allow-origin')).toBe(idpUrl);
  expect(session.headers.get('access-control-allow-credentials')).toBe('true');
  expect(session.headers.get('set-cookie')).toContain('better-auth.session_token=');
  const sessionBody = await session.text();
  expect(sessionBody).toContain(email);
  expect(sessionBody).not.toContain(token);
}

async function expectRevokedWebSession(cookie: string): Promise<void> {
  const session = await fetch(`${webUrl}/api/auth/get-session`, {
    headers: { cookie },
  });
  expect(session.status).toBe(success);
  expect(await session.json()).toBeNull();
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
    expect.arrayContaining([expect.stringContaining('better-auth.session_token=;')]),
  );
  expect(cookies.some((clearedCookie) => clearedCookie.includes('nuxt-auth-session'))).toBe(false);
}

async function verifySignInRejections(email: string): Promise<void> {
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
}

async function expectPrivateSignup(email: string, name: string): Promise<void> {
  const response = await submitCredentials('/api/signup', { email, name });
  expect(response.status).toBe(success);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({});
}

async function seedVerifiedPassword(
  database: ReturnType<typeof createDatabase>,
  email: string,
): Promise<void> {
  const auth = createAuth(database, {
    secret: 'ssr-test-secret-used-only-to-hash-passwords',
    url: webUrl,
    webOrigin: webUrl,
  });
  const context = await auth.$context;
  const hash = await context.password.hash(password);
  await database.$client`
    update iam.accounts as credential set password = ${hash} from iam.users as account
    where credential.user_id = account.id and credential.provider_id = 'credential'
      and account.email = ${email}
  `;
  await database.$client`update iam.users set email_verified = true where email = ${email}`;
}

test.skipIf(!process.env.AUTH_WEB_TEST_URL || !databasePort)(
  'the static UI uses one API session and keeps account data out of its shell',
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
      await expectPrivateSignup(email, name);
      await expectPrivateSignup(email, name);
      await seedVerifiedPassword(database, email);
      const signedIn = await submitCredentials('/api/signin', { email, password });
      const cookie = await readAuthCookies(signedIn);
      const [sessionRow] =
        await database.$client`update iam.sessions set expires_at = now() + interval '1 day' where user_id in (select id from iam.users where email = ${email}) returning token`;
      const payload = valibot.parse(payloadSchema, sessionRow);
      const account = await fetch(`${webUrl}/account`, { headers: { cookie } });
      expect(account.status).toBe(success);
      const html = await account.text();
      expect(html).not.toContain(email);
      expect(html).not.toContain(payload.token);
      expectSensitivePageHeaders(account);
      await verifyWebSession(cookie, email, payload.token);
      await verifySignOut(cookie);
      await expectRevokedWebSession(cookie);
      await verifySignInRejections(email);
    } finally {
      try {
        await database.$client`delete from iam.users where email = ${email}`;
      } finally {
        await database.$client.end();
      }
    }
  },
);

test.skipIf(!process.env.AUTH_WEB_TEST_URL)(
  'serves the public shell and its scripts without masking unknown API routes',
  async () => {
    const signIn = new URL('/signin', idpUrl);
    signIn.searchParams.set('redirect', '/admin');
    const redirect = await fetch(`${webUrl}/signin?${signIn.searchParams}`, { redirect: 'manual' });
    expect(redirect.status).toBe(seeOther);
    expect(redirect.headers.get('location')).toBe(signIn.href);

    const page = await fetch(signIn);
    expect(page.status).toBe(success);
    expectSensitivePageHeaders(page);
    const html = await page.text();
    const script = /src="(?<path>\/_idp\/[^"]+\.js)"/u.exec(html)?.groups?.path;
    if (!script) {
      throw new Error('Static shell script missing');
    }

    const asset = await fetch(new URL(script, idpUrl));
    expect(asset.status).toBe(success);
    expect(asset.headers.get('content-type')).toContain('javascript');

    if (apiUrl) {
      const apiPage = await fetch(new URL('/signin', apiUrl));
      expect(apiPage.status).toBe(notFound);

      const apiAsset = await fetch(new URL(script, apiUrl));
      expect(apiAsset.status).toBe(notFound);
    }

    const discovery = await fetch(`${webUrl}/.well-known/openid-configuration`);
    expect(discovery.status).toBe(success);
    expect(await discovery.json()).toMatchObject({ issuer: webUrl });

    const account = await fetch(`${webUrl}/account`);
    expect(account.status).toBe(success);
    expectSensitivePageHeaders(account);
    expect(await account.text()).toContain('/_nuxt/');

    const missing = await fetch(`${webUrl}/api/auth/not-an-endpoint`);
    expect(missing.status).toBe(notFound);
  },
);
