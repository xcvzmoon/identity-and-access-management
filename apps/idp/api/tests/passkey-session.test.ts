import { eq } from 'drizzle-orm';
import { H3Event } from 'nitro/h3';
import assert from 'node:assert/strict';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { users } from '../server/database/schema.ts';
import { finishPasskey, startPasskey } from '../server/services/passkey.service.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { seedAccount } from './fixtures/oidc.ts';

const enabled = process.env.IAM_PHASE7_TESTS === '1';
const challengeSchema = valibot.object({ challenge: valibot.string() });

test.skipIf(!enabled)(
  'rejects a passkey challenge transferred between two sessions of the same user',
  async ({ onTestFinished }) => {
    initializeEnv();
    const env = useEnv();
    assert.equal(env.db.database, 'iam_phase7_test');

    const auth = useAuth();
    const database = useDatabase();
    const account = await seedAccount();
    onTestFinished(async () => {
      await database.delete(users).where(eq(users.id, account.userId));
      await database.$client.end();
    });

    const firstSession = await auth.api.getSession({ headers: account.headers });
    assert.ok(firstSession);

    const endpoint = new URL(
      '/api/v1/auth/passkey/generate-authenticate-options',
      env.oidcIssuerUrl,
    );
    const options = await startPasskey(
      new H3Event(new Request(endpoint, { headers: account.headers })),
      'authentication',
    );
    const { challenge } = valibot.parse(challengeSchema, await options.json());
    const second = await auth.api.signInEmail({
      body: {
        email: account.email,
        password: account.password,
      },
      asResponse: true,
    });
    const cookies = [
      ...second.headers.getSetCookie(),
      ...options.headers.getSetCookie().filter((cookie) => cookie.includes('better-auth-passkey=')),
    ]
      .map((cookie) => cookie.split(';').shift())
      .join('; ');
    const verification = new Request(
      new URL('/api/v1/auth/passkey/verify-authentication', env.oidcIssuerUrl),
      {
        method: 'POST',
        headers: {
          cookie: cookies,
          origin: env.oidcIssuerUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          response: {
            id: 'fixture',
            response: {
              clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url'),
            },
          },
        }),
      },
    );

    await expect(finishPasskey(new H3Event(verification), 'authentication')).rejects.toThrow(
      'Start a new passkey challenge in this session.',
    );

    const original = await database.query.sessions.findFirst({
      where: { id: firstSession.session.id },
      columns: {
        passkeyChallenge: true,
        passkeyVerifiedAt: true,
      },
    });
    expect(original).toEqual({
      passkeyChallenge: challenge,
      passkeyVerifiedAt: null,
    });
  },
);
