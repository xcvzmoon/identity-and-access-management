import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { memberships, users } from '../server/database/schema.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { finishAccountEmail } from '../server/utils/mail.ts';
import { seedInvitation } from './fixtures/invitation.ts';

const OK = 200;
const TOO_MANY_REQUESTS = 429;
const SIGN_IN_WINDOW_MS = 11_000;
const FOUND = 302;
const EXPECTED_MEMBERSHIPS = 2;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const EMAIL_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 45_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function localUrl(setting: string | undefined): URL {
  assert.ok(setting, 'Configure the disposable fixture URL.');

  const url = new URL(setting);

  assert.ok(LOCAL_HOSTS.has(url.hostname), 'Use a loopback fixture endpoint.');
  return url;
}

async function apiRequest(
  path: string,
  body: Record<string, string> | null = null,
  cookie = '',
): Promise<Response> {
  const url = new URL(path, localUrl(process.env.IAM_PHASE3_API));
  return fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      origin: useEnv().oidcIssuerUrl,
      'content-type': 'application/json',
      cookie,
    },
    body: body && JSON.stringify(body),
    redirect: 'manual',
  });
}

async function emailLink(email: string, subject: string): Promise<URL> {
  const mailbox = new URL('/view/latest.txt', localUrl(process.env.IAM_PHASE3_MAILPIT));

  mailbox.searchParams.set('query', `to:"${email}" subject:"${subject}"`);

  await expect
    .poll(
      async () => {
        const result = await fetch(mailbox);
        return result.status;
      },
      { timeout: EMAIL_TIMEOUT_MS },
    )
    .toBe(OK);

  const message = await fetch(mailbox);
  const body = await message.text();
  const link = body.split(/\s+/u).find((part) => part.startsWith('https://'));

  assert.ok(link, 'Expected an account email link.');

  const url = new URL(link);

  expect(url.origin).toBe(useEnv().oidcIssuerUrl);
  return url;
}

async function passwordAttempt(email: string, password: string): Promise<Response> {
  const response = await apiRequest('/api/v1/auth/sign-in/email', { email, password });
  if (response.status === TOO_MANY_REQUESTS) {
    await delay(SIGN_IN_WINDOW_MS);
    return apiRequest('/api/v1/auth/sign-in/email', { email, password });
  }

  return response;
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await passwordAttempt(email, password);

  expect(response.status).toBe(OK);

  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(';').shift())
    .join('; ');

  assert.ok(cookies, 'Sign-in must issue a session cookie.');
  return cookies;
}

async function enroll(email: string, password: string): Promise<string> {
  const { token } = await seedInvitation(useDatabase(), { email });
  const response = await apiRequest('/api/v1/invitations/signup', {
    email,
    name: 'Invitee',
    password,
    token,
  });

  expect(response.status).toBe(OK);

  const url = await emailLink(email, 'Verify your email address');
  const verified = await apiRequest(url.pathname + url.search);

  expect(verified.status).toBe(FOUND);
  return token;
}

async function sendOrganizationInvitation(headers: Headers, email: string): Promise<string> {
  const auth = useAuth();
  const owner = await auth.api.getSession({ headers });

  assert.ok(owner);

  const organization = await auth.api.createOrganization({
    body: {
      name: 'Inviting organization',
      slug: randomUUID(),
      userId: owner.user.id,
    },
  });

  assert.ok(organization);

  const invitation = await auth.api.createInvitation({
    headers,
    body: {
      email,
      role: 'member',
      organizationId: organization.id,
    },
  });
  const link = await emailLink(email, 'Join your organization');
  const invitationToken = new URLSearchParams(link.hash.replace(/^#/u, '')).get('token');

  expect(link.pathname).toBe('/invite');
  expect(invitation.inviterId).toBe(owner.user.id);
  expect(invitationToken).toBe(invitation.id);

  return invitation.id;
}

async function rejectIneligibleSignups(): Promise<void> {
  const email = `${randomUUID()}@example.test`;
  const form = {
    email,
    name: 'Invitee',
    password: randomUUID(),
  };
  const database = useDatabase();
  const expired = await seedInvitation(database, {
    email,
    expiresAt: new Date('2000-01-01'),
  });
  const other = await seedInvitation(database, { email: `other-${email}` });
  const direct = await apiRequest('/api/v1/auth/sign-up/email', form);

  expect(direct.status).toBe(NOT_FOUND);

  const rejected = await Promise.all(
    [expired, other].map(async ({ token }) =>
      apiRequest('/api/v1/invitations/signup', { ...form, token }),
    ),
  );

  expect(rejected.map(({ status }) => status)).toEqual([BAD_REQUEST, BAD_REQUEST]);

  expect(await database.select({ id: users.id }).from(users).where(eq(users.email, email))).toEqual(
    [],
  );
}

async function acceptVerifiedInvitations(): Promise<void> {
  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();
  const token = await enroll(email, password);
  const cookie = await signIn(email, password);
  const database = useDatabase();
  const auth = useAuth();
  const headers = new Headers({ cookie });
  const otherToken = await sendOrganizationInvitation(headers, `other-${email}`);
  const anonymous = await apiRequest('/api/v1/invitations/accept', { token });

  expect(anonymous.status).toBe(UNAUTHORIZED);

  const wrongEmail = await apiRequest('/api/v1/invitations/accept', { token: otherToken }, cookie);

  expect(wrongEmail.status).toBe(BAD_REQUEST);

  const concurrent = await Promise.all([
    apiRequest('/api/v1/invitations/accept', { token }, cookie),
    apiRequest('/api/v1/invitations/accept', { token }, cookie),
  ]);

  expect(concurrent.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
    OK,
    BAD_REQUEST,
  ]);

  const replay = await apiRequest('/api/v1/invitations/accept', { token }, cookie);

  expect(replay.status).toBe(BAD_REQUEST);

  const existing = await seedInvitation(database, { email });
  const accepted = await apiRequest(
    '/api/v1/invitations/accept',
    { token: existing.token },
    cookie,
  );

  expect(accepted.status).toBe(OK);

  const session = await auth.api.getSession({ headers });

  expect(session?.session.activeOrganizationId).toBe(existing.organizationId);

  const matching = await database
    .select({ role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(users.email, email));

  expect(matching.filter((membership) => membership.role === 'member')).toHaveLength(
    EXPECTED_MEMBERSHIPS,
  );
}

describe.skipIf(process.env.IAM_PHASE3_TESTS !== '1')(
  'IdP invitation and recovery integration',
  () => {
    beforeAll(() => {
      initializeEnv();

      const { db } = useEnv();

      assert.ok(
        LOCAL_HOSTS.has(db.host) && db.database.startsWith('iam_phase3_test'),
        'Use a disposable local iam_phase3_test database.',
      );

      localUrl(process.env.IAM_PHASE3_API);
      localUrl(process.env.IAM_PHASE3_MAILPIT);
    });

    afterAll(async () => {
      await finishAccountEmail();
      await useDatabase().$client.end();
    });

    test(
      'rejects direct signup and ineligible invitations before creating an account',
      rejectIneligibleSignups,
    );

    test(
      'requires a verified invitee and commits exactly one membership on concurrent acceptance',
      acceptVerifiedInvitations,
      TEST_TIMEOUT_MS,
    );

    test(
      'reset consumes the email token, replaces the password and revokes both sessions',
      async () => {
        const email = `${randomUUID()}@example.test`;
        const password = randomUUID();
        const newPassword = randomUUID();

        await enroll(email, password);

        const first = await signIn(email, password);
        const second = await signIn(email, password);

        assert.ok(first !== second, 'Expected distinct sessions.');

        const request = await apiRequest('/api/v1/auth/request-password-reset', {
          email,
          redirectTo: new URL('/reset-password', useEnv().oidcIssuerUrl).href,
        });

        expect(request.status).toBe(OK);

        const url = await emailLink(email, 'Reset your password');
        const redirect = await apiRequest(url.pathname + url.search);
        const location = redirect.headers.get('location');

        assert.ok(location, 'Expected a redirect to the reset form.');

        const token = new URL(location).searchParams.get('token');

        assert.ok(token, 'Expected a password reset token.');

        const reset = await apiRequest('/api/v1/auth/reset-password', { token, newPassword });

        expect(reset.status).toBe(OK);

        const replay = await apiRequest('/api/v1/auth/reset-password', { token, newPassword });

        expect(replay.status).toBe(BAD_REQUEST);

        const oldPassword = await passwordAttempt(email, password);

        expect(oldPassword.status).toBe(UNAUTHORIZED);

        await signIn(email, newPassword);

        await Promise.all(
          [first, second].map(async (cookie) => {
            const session = await apiRequest('/api/v1/auth/get-session', null, cookie);
            expect(await session.json()).toBeNull();
          }),
        );
      },
      TEST_TIMEOUT_MS,
    );
  },
);
