import type { Auth } from '../src/utils/auth.ts';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../database/src/utils/client.ts';
import { createAuth } from '../src/utils/auth.ts';

const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const origin = 'http://localhost:5173';
const endpoint = `${origin}/api/auth/account/password-recovery`;
const originalPassword = 'original-recovery-test-password';
const replacementPassword = 'replacement-recovery-test-password';
const success = 200;
const badRequest = 400;
const forbidden = 403;
const firstMessage = 0;
const singleMessage = 1;
const expectedDeliveries = 2;

type Database = ReturnType<typeof createDatabase>;
type Mail = { email: string; otp: string };
type Action =
  | { action: 'request'; email: string }
  | { action: 'reset'; email: string; code: string; password: string };

function sessionHeaders(headers: Headers): Headers {
  const cookie = headers
    .getSetCookie()
    .map((header) => header.split(';').shift())
    .join('; ');

  return new Headers({ cookie });
}

async function recoveryRequest(
  auth: Auth,
  body: Action,
  requestOrigin = origin,
): Promise<Response> {
  return auth.handler(
    new Request(endpoint, {
      method: 'POST',
      headers: {
        origin: requestOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
}

async function verifyGenericResponses(
  auth: Auth,
  eligible: string,
  unverified: string,
): Promise<void> {
  const unknown = `${randomUUID()}@example.test`;
  const crossOrigin = await recoveryRequest(
    auth,
    {
      action: 'request',
      email: eligible,
    },
    'https://outside.example.test',
  );
  expect(crossOrigin.status).toBe(forbidden);
  await Promise.all(
    [eligible, unverified, unknown, eligible].map(async (email) => {
      const requested = await recoveryRequest(auth, {
        action: 'request',
        email,
      });
      expect(requested.status).toBe(success);
      expect(requested.headers.getSetCookie()).toEqual([]);
      expect(await requested.json()).toEqual({ accepted: true });
    }),
  );
}

async function registerAccount(auth: Auth, email: string): Promise<string> {
  const signup = await auth.api.signUpEmail({
    body: {
      name: 'Recovery test user',
      email,
      password: originalPassword,
    },
  });

  return signup.user.id;
}

async function provisionVerifiedAccount(
  database: Database,
  auth: Auth,
  email: string,
): Promise<Headers> {
  const id = await registerAccount(auth, email);
  await database.$client`update iam.users set email_verified = true where id = ${id}`;
  await database.$client`insert into iam.passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up)
    values (gen_random_uuid(), ${id}, ${randomUUID()}, 'test fixture', 0, 'singleDevice', false)`;
  const signedIn = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email,
      password: originalPassword,
    },
  });

  return sessionHeaders(signedIn.headers);
}

async function verifyActivation(auth: Auth, mail: Mail): Promise<void> {
  const { email, otp } = mail;
  const originalCredentials = {
    email,
    password: originalPassword,
  };
  await expect(auth.api.signInEmail({ body: originalCredentials })).rejects.toMatchObject({
    status: 'FORBIDDEN',
  });
  const response = await recoveryRequest(auth, {
    action: 'reset',
    email,
    code: otp,
    password: replacementPassword,
  });
  expect(response.status).toBe(success);
  expect(response.headers.getSetCookie()).toEqual([]);
  await expect(auth.api.signInEmail({ body: originalCredentials })).rejects.toMatchObject({
    status: 'UNAUTHORIZED',
  });
  const signedIn = await auth.api.signInEmail({
    body: {
      email,
      password: replacementPassword,
    },
  });
  expect(signedIn.user.emailVerified).toBe(true);
}

async function verifyReset(auth: Auth, mail: Mail): Promise<void> {
  const reset: Action = {
    action: 'reset',
    email: mail.email,
    code: mail.otp,
    password: replacementPassword,
  };
  const bad = await recoveryRequest(auth, {
    ...reset,
    code: mail.otp === '00000000' ? '11111111' : '00000000',
  });
  expect(bad.status).toBe(badRequest);
  expect(await bad.json()).toMatchObject({ code: 'RECOVERY_CODE_INVALID' });

  const results = await Promise.all([recoveryRequest(auth, reset), recoveryRequest(auth, reset)]);
  expect(results.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
    success,
    badRequest,
  ]);
  const completed = results.find(({ ok }) => ok);
  expect(completed?.headers.getSetCookie()).toEqual([]);
  expect(await completed?.json()).toEqual({ reset: true });

  const replay = await recoveryRequest(auth, reset);
  expect(replay.status).toBe(badRequest);
  expect(await replay.json()).toMatchObject({ code: 'RECOVERY_CODE_INVALID' });
}

async function verifyCredentials(auth: Auth, email: string, sessions: Headers[]): Promise<void> {
  await Promise.all(
    sessions.map(async (headers) => {
      expect(await auth.api.getSession({ headers })).toBeNull();
    }),
  );
  await expect(
    auth.api.signInEmail({
      body: {
        email,
        password: originalPassword,
      },
    }),
  ).rejects.toThrow();
  const signedIn = await auth.api.signInEmail({
    body: {
      email,
      password: replacementPassword,
    },
  });
  expect(signedIn.user.emailVerified).toBe(true);
}

test.skipIf(!databasePort)(
  'password recovery revokes every session and consumes the code once',
  async () => {
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    const eligible = `${randomUUID()}@example.test`;
    const unverified = `${randomUUID()}@example.test`;
    const messages: Mail[] = [];
    const auth = createAuth(database, {
      secret: 'password-recovery-integration-test-secret',
      url: origin,
      webOrigin: origin,
      sendPasswordRecoveryEmail: async (mail) => {
        await setImmediate();
        messages.push(mail);
      },
    });
    const identifier = `forget-password-otp-${eligible}`;

    try {
      const first = await provisionVerifiedAccount(database, auth, eligible);
      await registerAccount(auth, unverified);
      const second = await auth.api.signInEmail({
        body: {
          email: eligible,
          password: originalPassword,
        },
        returnHeaders: true,
      });
      await verifyGenericResponses(auth, eligible, unverified);
      await expect.poll(() => messages.length).toBe(expectedDeliveries);
      const mail = messages.find(({ email }) => email === eligible);
      const activation = messages.find(({ email }) => email === unverified);
      if (!mail || !activation) {
        throw new Error('Recovery or verification email missing');
      }

      expect(mail.email).toBe(eligible);
      const stored = await database.$client<
        { value: string }[]
      >`select value from iam.verifications where identifier = ${identifier}`;
      expect(stored.at(firstMessage)?.value).toMatch(/^[0-9a-f]{64}:0$/u);
      await verifyReset(auth, mail);
      await verifyCredentials(auth, eligible, [first, sessionHeaders(second.headers)]);
      await verifyActivation(auth, activation);
      const passkeys = await database.$client`select passkey.id from iam.passkeys passkey
      join iam.users account on account.id = passkey.user_id where account.email = ${eligible}`;
      expect(passkeys).toHaveLength(singleMessage);
    } finally {
      try {
        await database.$client`delete from iam.rate_limits where key in (
        select 'iam:password-recovery:' || id from iam.users where email in (${eligible}, ${unverified})
      )`;
        const activationIdentifier = `forget-password-otp-${unverified}`;
        await database.$client`delete from iam.verifications where identifier in (${identifier}, ${activationIdentifier})`;
        await database.$client`delete from iam.users where email in (${eligible}, ${unverified})`;
      } finally {
        await database.$client.end();
      }
    }
  },
);
