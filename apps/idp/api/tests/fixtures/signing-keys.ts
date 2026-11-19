import { eq } from 'drizzle-orm';
import * as valibot from 'valibot';
import { expect } from 'vite-plus/test';
import { useDatabase } from '../../server/database/index.ts';
import { signingKeys } from '../../server/database/schema.ts';

const MODULUS = 'n';
const EXPONENT = 'e';
const PRIVATE_EXPONENT = 'd';

const discoverySchema = valibot.object({
  issuer: valibot.string(),
  jwks_uri: valibot.string(),
});
const keySchema = valibot.object({
  kid: valibot.string(),
  kty: valibot.literal('RSA'),
  alg: valibot.literal('RS256'),
  [MODULUS]: valibot.string(),
  [EXPONENT]: valibot.string(),
  [PRIVATE_EXPONENT]: valibot.optional(valibot.never()),
});
const jwksSchema = valibot.object({ keys: valibot.tuple([keySchema]) });

async function readPublicKey(url: string): Promise<valibot.InferOutput<typeof keySchema>> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);

  const {
    keys: [key],
  } = valibot.parse(jwksSchema, await response.json());
  return key;
}

/**
 * @param {string} issuer - HTTPS origin used by the browser fixture.
 * @returns {Promise<void>} Resolves when concurrent JWKS reads match the stored signing key.
 */
export async function verifySigningKeys(issuer: string): Promise<void> {
  const response = await fetch(new URL('/.well-known/openid-configuration', issuer));
  const metadata = valibot.parse(discoverySchema, await response.json());
  const url = new URL('/api/v1/auth/jwks', issuer);

  expect(response.ok).toBe(true);
  expect(metadata.issuer).toBe(issuer);
  expect(metadata.jwks_uri).toBe(url.href);

  const [first, second] = await Promise.all([readPublicKey(url.href), readPublicKey(url.href)]);
  const database = useDatabase();
  const rows = await database
    .select({ publicKey: signingKeys.publicKey })
    .from(signingKeys)
    .where(eq(signingKeys.id, first.kid));
  const [row] = rows;

  expect(first).toEqual(second);
  expect(JSON.parse(row.publicKey)).toMatchObject({
    kty: first.kty,
    [MODULUS]: first.n,
    [EXPONENT]: first.e,
  });
}
