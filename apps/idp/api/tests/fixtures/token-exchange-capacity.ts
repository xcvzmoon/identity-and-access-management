import type { Page } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import * as valibot from 'valibot';
import { type Client, authorizationUrl, exchange } from './oidc-protocol.ts';
import { measureRequests } from './request-capacity.ts';

const REQUESTS = 8;
const CONCURRENCY = 2;
const VERIFIER_BYTES = 32;
const OK = 200;
const EXPIRED = 0;

const issuedToken = valibot.pipe(valibot.string(), valibot.nonEmpty());
const tokens = valibot.object({
  access_token: issuedToken,
  id_token: issuedToken,
  token_type: valibot.picklist(['Bearer', 'bearer']),
  expires_in: valibot.pipe(valibot.number(), valibot.gtValue(EXPIRED)),
});

/**
 * Measures redemption of distinct authorization codes after the browser has granted consent.
 * @param {Page} page - Browser with an authenticated IdP session.
 * @param {Client} client - Confidential installation with an approved grant.
 * @param {string} callback - Registered redirect URI.
 * @param {string} output - New file for aggregate timings.
 */
export async function recordExchangeCapacity(
  page: Page,
  client: Client,
  callback: string,
  output: string,
): Promise<void> {
  const grants = await Promise.all(
    Array.from({ length: REQUESTS }, async () => {
      const verifier = randomBytes(VERIFIER_BYTES).toString('base64url');
      const authorize = authorizationUrl(client, callback, verifier);
      const response = await page.request.get(authorize.href, { maxRedirects: 0 });
      const redirect = URL.parse(response.headers().location);
      assert.ok(redirect);
      assert.ok(redirect.origin + redirect.pathname === callback);
      assert.ok(redirect.searchParams.get('state') === authorize.searchParams.get('state'));
      const code = redirect.searchParams.get('code');
      assert.ok(code);
      return { code, verifier };
    }),
  );
  assert.equal(new Set(grants.map((grant) => grant.code)).size, REQUESTS);

  const sample = await measureRequests(REQUESTS, CONCURRENCY, async () => {
    const grant = grants.pop();
    assert.ok(grant);
    const started = performance.now();
    const response = await exchange(client, callback, grant.code, grant.verifier).catch(() => null);
    const body: unknown = await response?.json().catch(() => null);
    const elapsed = performance.now() - started;
    return response?.status === OK && valibot.is(tokens, body) ? elapsed : null;
  });

  await writeFile(output, `${JSON.stringify(sample)}\n`, { flag: 'wx' });
  assert.equal(sample.successful, REQUESTS);
}
