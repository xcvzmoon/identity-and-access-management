import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as valibot from 'valibot';
import { expect } from 'vite-plus/test';
import { useDatabase } from '../../server/database/index.ts';
import { oauthClients } from '../../server/database/schema.ts';
import { provisionClient } from '../../server/services/registration.service.ts';
import { authorizationUrl, exchange } from './oidc-protocol.ts';

const RANDOM_BYTES = 32;

const redirectSchema = valibot.object({
  redirect: valibot.literal(true),
  url: valibot.string(),
});

/**
 * Checks the reserved console registration using a verified session with no memberships.
 * @param {Headers} headers - Session cookie for the fixture user.
 * @param {string} callback - Registered HTTPS callback.
 */
export async function verifyConsoleAccess(headers: Headers, callback: string): Promise<void> {
  const database = useDatabase();
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const client = await provisionClient(headers, {
    kind: 'console',
    name: 'IAM console',
    redirectUris: [callback],
  });

  try {
    const url = authorizationUrl(client, callback, verifier);
    const response = await fetch(url, {
      headers,
      redirect: 'manual',
    });
    const result = valibot.parse(redirectSchema, await response.json());
    const redirect = new URL(result.url);
    const code = redirect.searchParams.get('code');

    assert.ok(code);
    expect(client.clientId).toBe('iam-console');
    expect(redirect.origin + redirect.pathname).toBe(callback);

    const tokens = await exchange(client, callback, code, verifier);
    expect(tokens.ok).toBe(true);
  } finally {
    await database.delete(oauthClients).where(eq(oauthClients.clientId, client.clientId));
  }
}
