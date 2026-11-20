import { text } from 'node:stream/consumers';
import { useDatabase } from '../server/database/index.ts';
import { requireFreshStepUp } from '../server/services/passkey.service.ts';
import { provisionClient } from '../server/services/registration.service.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';

initializeEnv();

const env = useEnv();
const origin = process.env.CONSOLE_ORIGIN;
const url = origin && URL.parse(origin);

if (!url || url.protocol !== 'https:' || url.origin !== origin || origin === env.oidcIssuerUrl) {
  throw new Error('Set CONSOLE_ORIGIN to a separate, bare HTTPS origin.');
}

if (process.stdin.isTTY || process.stdout.isTTY) {
  throw new Error(
    'Pipe the session cookie from a protected file and capture the secret on stdout.',
  );
}

const cookie = await text(process.stdin);
const headers = new Headers({ cookie: cookie.trim() });
const database = useDatabase();
const auth = useAuth();

try {
  const session = await auth.api.getSession({ headers });
  if (!session?.user.emailVerified || !env.operatorUserIds.includes(session.user.id)) {
    throw new Error('A verified operator session is required.');
  }

  const registration = await database.transaction(async (transaction) => {
    await requireFreshStepUp(session.user.id, session.session.id, transaction);

    return provisionClient(
      headers,
      {
        kind: 'console',
        name: 'IAM console',
        redirectUris: [new URL('/api/v1/callback', url).href],
      },
      transaction,
    );
  });

  process.stdout.write(registration.clientSecret);
} finally {
  await database.$client.end();
}
