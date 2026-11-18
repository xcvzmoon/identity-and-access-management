import type { MemoryDB } from '@better-auth/memory-adapter';
import type { OAuthClientAdministrativeResponse } from '@better-auth/oauth-provider';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { createHash, randomBytes } from 'node:crypto';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createApplicationOidcProvider } from '../src/utils/oidc.ts';

const issuer = 'https://iam.example.test';
const callback = 'https://app.example.test/callback';
const forbidden = 403;
const badRequest = 400;
const secretBytes = 32;
const loginPassword = 'test-only-password';
const transactionBytes = 16;

type Fixture = {
  assignments: Map<string, string>;
  controlAssignment: string;
  appAssignment: string;
  database: MemoryDB;
  handler: (request: Request) => Promise<Response>;
  app: OAuthClientAdministrativeResponse;
  control: OAuthClientAdministrativeResponse;
  cookie: string;
  verifier: string;
};

function redirectUrl(response: Response): URL {
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`Expected a redirect, received ${response.status}`);
  }

  return new URL(location);
}

async function setup(): Promise<Fixture> {
  const assignments = new Map<string, string>();
  const database: MemoryDB = {
    user: [],
    account: [],
    session: [],
    verification: [],
    oauthClient: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
    oauthResource: [],
    oauthClientResource: [],
    jwks: [],
  };
  const auth = betterAuth({
    baseURL: issuer,
    secret: randomBytes(secretBytes).toString('base64url'),
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      createApplicationOidcProvider(
        `${issuer}/login`,
        `${issuer}/consent`,
        {
          resolveAccess: (clientId, userId) => assignments.get(`${clientId}/${userId}`) ?? null,
          readTokenAccess: () => null,
        },
        { clientPrivileges: () => true },
      ),
    ],
  });
  const signup = await auth.api.signUpEmail({
    returnHeaders: true,
    body: {
      name: 'Fixture',
      email: 'fixture@example.test',
      password: loginPassword,
    },
  });
  const { user } = signup.response;
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => {
      const [pair] = value.split(';');
      return pair;
    })
    .join('; ');
  const clientBody = {
    redirect_uris: [callback],
    token_endpoint_auth_method: 'client_secret_basic',
    skip_consent: true,
  } satisfies {
    redirect_uris: string[];
    token_endpoint_auth_method: 'client_secret_basic';
    skip_consent: boolean;
  };
  const control = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: clientBody,
  });
  const app = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: clientBody,
  });
  const verifier = randomBytes(secretBytes).toString('base64url');
  const controlAssignment = `${control.client_id}/${user.id}`;
  const appAssignment = `${app.client_id}/${user.id}`;

  return {
    assignments,
    controlAssignment,
    appAssignment,
    database,
    handler: auth.handler,
    app,
    control,
    cookie,
    verifier,
  };
}

async function authorize(
  fixture: Fixture,
  clientId: string,
  options: { prompt?: 'consent'; scope?: string } = {},
): Promise<Response> {
  const { prompt, scope = 'openid' } = options;
  const url = new URL('/api/auth/oauth2/authorize', issuer);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: 'code',
    scope,
    state: randomBytes(transactionBytes).toString('hex'),
    nonce: randomBytes(transactionBytes).toString('hex'),
    code_challenge: createHash('sha256').update(fixture.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();

  if (prompt) {
    url.searchParams.set('prompt', prompt);
  }

  return fixture.handler(
    new Request(url, {
      headers: {
        cookie: fixture.cookie,
        accept: 'text/html',
      },
    }),
  );
}

test('issues codes only for the assigned application, including after consent', async () => {
  const fixture = await setup();
  fixture.assignments.set(fixture.controlAssignment, 'control-installation');
  const denied = await authorize(fixture, fixture.app.client_id);
  expect(denied.status).toBe(forbidden);
  expect(await denied.json()).toEqual({ error: 'access_denied' });

  fixture.assignments.set(fixture.appAssignment, 'app-installation');
  const consent = redirectUrl(
    await authorize(fixture, fixture.app.client_id, { prompt: 'consent' }),
  );
  expect(consent.pathname).toBe('/consent');
  fixture.assignments.delete(fixture.appAssignment);
  const resumed = await fixture.handler(
    new Request(`${issuer}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: {
        origin: issuer,
        cookie: fixture.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: consent.searchParams.toString(),
      }),
    }),
  );
  expect(resumed.status).toBe(forbidden);
  expect(await resumed.json()).toEqual({ error: 'access_denied' });
  expect(fixture.database.verification).toEqual([]);

  const allowed = await authorize(fixture, fixture.control.client_id);
  expect(redirectUrl(allowed).searchParams.get('code')).toBeTruthy();
});

test('rejects unsupported scopes without issuing a code', async () => {
  const fixture = await setup();
  fixture.assignments.set(fixture.appAssignment, 'app-installation');
  const reply = await authorize(fixture, fixture.app.client_id, { scope: 'openid profile' });
  const destination = redirectUrl(reply);
  expect(destination.origin + destination.pathname).toBe(callback);
  expect(destination.searchParams.get('error')).toBe('invalid_scope');
  expect(destination.searchParams.has('code')).toBe(false);
  expect(fixture.database.verification).toEqual([]);
});

async function exchange(
  fixture: Fixture,
  client: OAuthClientAdministrativeResponse,
  code: string,
): Promise<Response> {
  if (!client.client_secret) {
    throw new Error('Expected a confidential client credential');
  }

  const credential = Buffer.from(`${client.client_id}:${client.client_secret}`);
  return fixture.handler(
    new Request(`${issuer}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${credential.toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback,
        code_verifier: fixture.verifier,
      }),
    }),
  );
}

test('checks the current app assignment before issuing tokens', async () => {
  const fixture = await setup();
  fixture.assignments.set(fixture.appAssignment, 'app-installation');
  const allowed = await authorize(fixture, fixture.app.client_id);
  const code = redirectUrl(allowed).searchParams.get('code');
  if (!code) {
    throw new Error('Expected an authorization code');
  }

  fixture.assignments.delete(fixture.appAssignment);

  const response = await exchange(fixture, fixture.app, code);
  expect(response.status).toBe(badRequest);
  expect(await response.json()).toEqual({ error: 'invalid_grant' });
  expect(fixture.database.oauthAccessToken).toEqual([]);
});

test('returns tokens for an active assignment', async () => {
  const fixture = await setup();
  fixture.assignments.set(fixture.appAssignment, 'app-installation');
  const allowed = await authorize(fixture, fixture.app.client_id);
  const code = redirectUrl(allowed).searchParams.get('code');
  if (!code) {
    throw new Error('Expected an authorization code');
  }

  const response = await exchange(fixture, fixture.app, code);
  expect(response.ok).toBe(true);
  const tokenResponse = valibot.object({
    access_token: valibot.pipe(valibot.string(), valibot.nonEmpty()),
    id_token: valibot.pipe(valibot.string(), valibot.nonEmpty()),
  });
  expect(valibot.safeParse(tokenResponse, await response.json()).success).toBe(true);
});
