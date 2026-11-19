import { createHash, randomBytes } from 'node:crypto';
import { useEnv } from '../../server/utils/env.ts';

export type Client = { clientId: string; clientSecret: string };

const RANDOM_BYTES = 32;

/**
 * Builds an authorization request using the supplied PKCE verifier.
 * @param {Client} client - Registered client.
 * @param {string} callback - Registered redirect URI.
 * @param {string} verifier - Code verifier retained for the exchange.
 * @returns {URL} Issuer authorization endpoint with the request parameters.
 */
export function authorizationUrl(client: Client, callback: string, verifier: string): URL {
  const env = useEnv();
  const url = new URL('/api/v1/auth/oauth2/authorize', env.oidcIssuerUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: callback,
    scope: 'openid',
    state: randomBytes(RANDOM_BYTES).toString('hex'),
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }).toString();
  return url;
}

/**
 * Exchanges a code using the installation's credentials and original verifier.
 * @param {Client} client - Confidential client credentials.
 * @param {string} callback - Redirect URI supplied when requesting the code.
 * @param {string} code - Authorization code from the issuer.
 * @param {string} verifier - Code verifier for this authorization request.
 * @returns {Promise<Response>} Token endpoint response.
 */
export async function exchange(
  client: Client,
  callback: string,
  code: string,
  verifier: string,
): Promise<Response> {
  const env = useEnv();
  const credentials = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
  return fetch(new URL('/api/v1/auth/oauth2/token', env.oidcIssuerUrl), {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}` },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: callback,
      code,
      code_verifier: verifier,
    }),
  });
}
