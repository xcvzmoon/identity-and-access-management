import type { Configuration } from 'openid-client';
import type { Pool } from 'pg';
import type { Page } from 'playwright';
import { symmetricEncrypt } from 'better-auth/crypto';
import { generateExportedKeyPair } from 'better-auth/plugins/jwt';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { deepEqual, equal, ok } from 'node:assert/strict';
import * as oidc from 'openid-client';
import { ClientSecretBasic as clientSecretBasic } from 'openid-client';
import * as valibot from 'valibot';
import { authPath } from './provider.ts';

const signingAlgorithm = 'RS256';
const okStatus = 200;
const oneKey = 1;
const firstRow = 0;
const modulus = 'n';
const exponent = 'e';
const jwksSchema = valibot.object({
  keys: valibot.array(
    valibot.looseObject({
      kid: valibot.string(),
      kty: valibot.literal('RSA'),
      alg: valibot.literal(signingAlgorithm),
      [modulus]: valibot.string(),
      [exponent]: valibot.string(),
    }),
  ),
});
const registrationOptions = valibot.object({
  challenge: valibot.string(),
  rp: valibot.object({
    id: valibot.string(),
    name: valibot.string(),
  }),
  user: valibot.object({
    id: valibot.string(),
    name: valibot.string(),
    displayName: valibot.string(),
  }),
  pubKeyCredParams: valibot.array(
    valibot.object({
      type: valibot.literal('public-key'),
      alg: valibot.number(),
    }),
  ),
  authenticatorSelection: valibot.object({ userVerification: valibot.literal('required') }),
});
const authenticationOptions = valibot.object({
  challenge: valibot.string(),
  rpId: valibot.string(),
  userVerification: valibot.literal('required'),
});

async function readJwks(origin: string): Promise<valibot.InferOutput<typeof jwksSchema>> {
  const response = await fetch(`${origin}${authPath}/jwks`);
  equal(response.status, okStatus);
  const keys = valibot.parse(jwksSchema, await response.json());
  for (const key of keys.keys) {
    equal('d' in key, false);
  }
  return keys;
}

async function activateSigningKey(pool: Pool, keyId: string): Promise<void> {
  const transaction = await pool.connect();
  try {
    await transaction.query('begin');
    await transaction.query('select pg_advisory_xact_lock(hashtext($1))', [
      'evaluation-signing-key',
    ]);
    await transaction.query(
      'update evaluation_keys set "expiresAt" = now() where "expiresAt" is null',
    );
    const { rowCount } = await transaction.query(
      'update evaluation_keys set "expiresAt" = null where id = $1',
      [keyId],
    );
    equal(rowCount, oneKey);
    await transaction.query('commit');
  } catch (error) {
    await transaction.query('rollback');
    throw error;
  } finally {
    transaction.release();
  }
}

type RolloverOptions = {
  pool: Pool;
  issuer: string;
  replica: string;
  secret: string;
  originalIdToken: string;
  audience: string;
  issueIdToken: (origin: string) => Promise<string>;
};

async function proveRollover(options: RolloverOptions): Promise<void> {
  const { pool, issuer, replica, secret, originalIdToken, audience, issueIdToken } = options;
  const { kid: original } = decodeProtectedHeader(originalIdToken);
  ok(original);
  const { publicWebKey, privateWebKey } = await generateExportedKeyPair({
    jwks: { keyPairConfig: { alg: signingAlgorithm } },
  });
  const encrypted = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify(privateWebKey),
  });
  const { rows } = await pool.query<{ id: string }>(
    `insert into evaluation_keys ("publicKey", "privateKey", alg, "expiresAt")
     values ($1, $2, $3, now() - interval '1 second') returning id`,
    [JSON.stringify(publicWebKey), JSON.stringify(encrypted), signingAlgorithm],
  );
  const replacement = rows.at(firstRow)?.id;
  ok(replacement);
  const [published, replicaPublished] = await Promise.all([readJwks(issuer), readJwks(replica)]);
  const expectedKids = [original, replacement].toSorted();
  deepEqual(published.keys.map(({ kid }) => kid).toSorted(), expectedKids);
  deepEqual(replicaPublished.keys.map(({ kid }) => kid).toSorted(), expectedKids);
  equal(decodeProtectedHeader(await issueIdToken(issuer)).kid, original);
  equal(decodeProtectedHeader(await issueIdToken(replica)).kid, original);

  await activateSigningKey(pool, replacement);
  const newPrimary = await issueIdToken(issuer);
  const newReplica = await issueIdToken(replica);
  const verify = createLocalJWKSet(published);
  const verificationOptions = {
    issuer,
    audience,
    algorithms: [signingAlgorithm],
  };
  await jwtVerify(originalIdToken, verify, verificationOptions);
  const verified = await Promise.all(
    [newPrimary, newReplica].map(async (token) => jwtVerify(token, verify, verificationOptions)),
  );
  for (const { protectedHeader } of verified) {
    equal(protectedHeader.kid, replacement);
  }

  await activateSigningKey(pool, original);
  equal(decodeProtectedHeader(await issueIdToken(issuer)).kid, original);
  equal(decodeProtectedHeader(await issueIdToken(replica)).kid, original);
  const overlap = createLocalJWKSet(await readJwks(replica));
  await jwtVerify(newReplica, overlap, {
    issuer,
    audience,
    algorithms: [signingAlgorithm],
  });
  process.stdout.write(
    'PASS both replicas staged and activated RS256, retained prior tokens, and rolled back\n',
  );
}

type ExchangeOptions = {
  page: Page;
  configuration: Configuration;
  callback: string;
  tokenOrigin: string;
  credentials: { clientId: string; clientSecret: string };
  beforeExchange?: () => Promise<void>;
};

async function exchangeOnReplica(options: ExchangeOptions): Promise<string> {
  const { page, configuration, callback, tokenOrigin, credentials, beforeExchange } = options;
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const destination = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: callback,
    scope: 'openid',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  const authorization = await page.request.get(destination.href, { maxRedirects: 0 });
  const location = authorization.headers().location;
  ok(location);
  const callbackURL = new URL(location);
  equal(callbackURL.origin, new URL(callback).origin);
  const replicaConfig = new oidc.Configuration(
    {
      issuer: configuration.serverMetadata().issuer,
      token_endpoint: `${tokenOrigin}${authPath}/oauth2/token`,
      jwks_uri: configuration.serverMetadata().jwks_uri,
      id_token_signing_alg_values_supported: [signingAlgorithm],
    },
    credentials.clientId,
    credentials.clientSecret,
    clientSecretBasic(credentials.clientSecret),
  );
  oidc.enableNonRepudiationChecks(replicaConfig);
  await beforeExchange?.();
  const tokens = await oidc.authorizationCodeGrant(replicaConfig, callbackURL, {
    expectedState: state,
    expectedNonce: nonce,
    pkceCodeVerifier: verifier,
    idTokenExpected: true,
  });
  ok(tokens.id_token);
  return tokens.id_token;
}

async function completePasskeyStepUp(page: Page, issuer: string): Promise<void> {
  await page.goto(issuer);
  const connection = await page.context().newCDPSession(page);
  await connection.send('WebAuthn.enable');
  await connection.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const register = await page.request.get(`${issuer}${authPath}/passkey/generate-register-options`);
  const createOptions = valibot.parse(registrationOptions, await register.json());
  const registration = await page.evaluate(
    async ({ path, input }) => {
      const options = PublicKeyCredential.parseCreationOptionsFromJSON(input);
      options.authenticatorSelection = {
        residentKey: 'required',
        userVerification: 'required',
      };
      const credential = await navigator.credentials.create({ publicKey: options });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new TypeError('Chromium did not register a credential.');
      }
      const result = await fetch(`${path}/passkey/verify-registration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: credential.toJSON() }),
      });
      return result.status;
    },
    {
      path: authPath,
      input: createOptions,
    },
  );
  equal(registration, okStatus);
  const authenticate = await page.request.get(
    `${issuer}${authPath}/passkey/generate-authenticate-options`,
  );
  const requestOptions = valibot.parse(authenticationOptions, await authenticate.json());
  const authentication = await page.evaluate(
    async ({ path, input }) => {
      const options = PublicKeyCredential.parseRequestOptionsFromJSON(input);
      const credential = await navigator.credentials.get({ publicKey: options });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new TypeError('Chromium did not sign the challenge.');
      }
      const result = await fetch(`${path}/passkey/verify-authentication`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: credential.toJSON() }),
      });
      return result.status;
    },
    {
      path: authPath,
      input: requestOptions,
    },
  );
  equal(authentication, okStatus);
  await connection.detach();
}

export { completePasskeyStepUp, exchangeOnReplica, proveRollover };
