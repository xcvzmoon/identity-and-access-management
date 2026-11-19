import { generateKeyPairSync, sign } from 'node:crypto';
import * as oidc from 'openid-client';
import { expect, test, vi } from 'vite-plus/test';

const issuer = 'https://issuer.example.test';
const callback = 'https://app.example.test/callback';
const clientId = 'fixture-client';
const state = 'fixture-state';
const nonce = 'fixture-nonce';
const kid = 'fixture-issuer-key';
const modulusLength = 2048;
const millisecondsPerSecond = 1000;
const lifetimeSeconds = 300;
const { None: noClientAuthentication } = oidc;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength });
type ComparedClaim = 'iss' | 'aud' | 'nonce';
const comparedClaims: readonly ComparedClaim[] = ['iss', 'aud', 'nonce'];

function createFixtureToken(overrides: Partial<Record<ComparedClaim, string>>): string {
  const issuedAt = Math.floor(Date.now() / millisecondsPerSecond);
  const header = Buffer.from(
    JSON.stringify({
      alg: 'RS256',
      kid,
    }),
  ).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: clientId,
      sub: 'fixture-subject',
      exp: issuedAt + lifetimeSeconds,
      iat: issuedAt,
      nonce,
      ...overrides,
    }),
  ).toString('base64url');
  const message = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(message), privateKey);
  return `${message}.${signature.toString('base64url')}`;
}

function createClient(idToken: string, tokenType: string): oidc.Configuration {
  const client = new oidc.Configuration(
    {
      issuer,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    },
    clientId,
    { id_token_signed_response_alg: 'RS256' },
    noClientAuthentication(),
  );
  oidc.enableNonRepudiationChecks(client);
  client[oidc.customFetch] = vi
    .fn<oidc.CustomFetch>()
    .mockResolvedValueOnce(
      Response.json({
        token_type: tokenType,
        access_token: 'fixture-access-token',
        id_token: idToken,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        keys: [
          {
            ...publicKey.export({ format: 'jwk' }),
            kid,
            alg: 'RS256',
          },
        ],
      }),
    );
  return client;
}

async function completeSignIn(
  tokenOverrides: Partial<Record<ComparedClaim, string>>,
  options: { returnedState?: string; tokenType?: string } = {},
): Promise<oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers> {
  const { returnedState = state, tokenType = 'Bearer' } = options;
  const returned = new URL(callback);
  returned.search = new URLSearchParams({
    code: 'fixture-code',
    state: returnedState,
  }).toString();
  return oidc.authorizationCodeGrant(
    createClient(createFixtureToken(tokenOverrides), tokenType),
    returned,
    {
      pkceCodeVerifier: oidc.randomPKCECodeVerifier(),
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    },
  );
}

test('accepts a signed ID token bound to the expected issuer, client and nonce', async () => {
  const response = await completeSignIn({});
  expect(response.claims()).toMatchObject({ sub: 'fixture-subject' });
});

test.each(comparedClaims)(
  'denies a validly signed ID token with a mismatched %s claim',
  async (claim) => {
    await expect(
      completeSignIn({ [claim]: 'https://different.example.test' }),
    ).rejects.toMatchObject({
      cause: { cause: { claim } },
    });
  },
);

test('denies a callback with unexpected state', async () => {
  await expect(completeSignIn({}, { returnedState: 'unexpected-state' })).rejects.toMatchObject({
    cause: { message: 'unexpected "state" response parameter value' },
  });
});

test('denies a token response with an unsupported token type', async () => {
  await expect(completeSignIn({}, { tokenType: 'unsupported' })).rejects.toMatchObject({
    code: 'OAUTH_UNSUPPORTED_OPERATION',
  });
});
