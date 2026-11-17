import { randomUUID } from 'node:crypto';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';

const webUrl = process.env.AUTH_SSR_TEST_URL ?? 'http://localhost:5173';
const apiUrl = 'http://localhost:3000';
const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const success = 200;
const redirect = 302;
const notFound = 404;
const payloadSchema = valibot.object({ token: valibot.string() });

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
      const registered = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          origin: webUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email,
          name,
          password: 'ssr-test-password',
        }),
      });
      expect(registered.status).toBe(success);
      const payload = valibot.parse(payloadSchema, await registered.json());
      const cookie = registered.headers
        .getSetCookie()
        .map((value) => {
          const [pair] = value.split(';');
          return pair;
        })
        .join('; ');
      expect(cookie).toContain('better-auth.session_token=');
      await database.$client`update iam.sessions set expires_at = now() + interval '1 day' where user_id in (select id from iam.users where email = ${email})`;
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
      const signIn = await fetch(`${webUrl}/signin`, {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(signIn.status).toBe(redirect);
      expect(signIn.headers.get('location')).toBe('/account');
      const signedOut = await fetch(`${apiUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          cookie,
          origin: webUrl,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(signedOut.status).toBe(success);
      const revoked = await fetch(`${webUrl}/account`, {
        headers: { cookie },
        redirect: 'manual',
      });
      expect(revoked.status).toBe(redirect);
      expect(revoked.headers.get('location')).toContain('/signin');
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
  'SSR redirects guests and does not host auth mutations',
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
    const localSession = await fetch(`${webUrl}/api/auth/get-session`);
    expect(localSession.status).toBe(notFound);
    const localSignUp = await fetch(`${webUrl}/api/auth/sign-up/email`, { method: 'POST' });
    expect(localSignUp.status).toBe(notFound);
  },
);
