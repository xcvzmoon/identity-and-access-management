import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { ClientSecretBasic as clientSecretBasic } from 'openid-client';
import * as oidc from 'openid-client';
import * as valibot from 'valibot';

type Login = {
  verifier: string;
  state: string;
  nonce: string;
  expiresAt: number;
};

const UNAVAILABLE = 503;
const SEE_OTHER = 303;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const OK = 200;
const LOGIN_LIFETIME_MS = 600_000;
const MAX_PENDING_LOGINS = 4096;
const COOKIE_NAME = '__Host-iam-reference-login';
const MILLISECONDS_PER_SECOND = 1000;
const EXPIRED = 0;

const port = valibot.optional(valibot.pipe(valibot.string(), valibot.digits()), '8080');
const httpsOrigin = valibot.pipe(
  valibot.string(),
  valibot.check((value) => value.startsWith('https://') && URL.parse(value)?.origin === value),
);
const settings = valibot.parse(
  valibot.object({
    OIDC_ISSUER_URL: httpsOrigin,
    APP_ORIGIN: httpsOrigin,
    CLIENT_ID: valibot.pipe(valibot.string(), valibot.nonEmpty()),
    CLIENT_SECRET: valibot.pipe(valibot.string(), valibot.nonEmpty()),
    PORT: port,
  }),
  process.env,
);
const configuration = await oidc.discovery(
  new URL(settings.OIDC_ISSUER_URL),
  settings.CLIENT_ID,
  { id_token_signed_response_alg: 'RS256' },
  clientSecretBasic(settings.CLIENT_SECRET),
  { execute: [oidc.enableNonRepudiationChecks] },
);
const callback = new URL('/callback', settings.APP_ORIGIN);
const logins = new Map<string, Login>();

function loginCookie(value: string, maxAge: number): string {
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

async function beginLogin(response: ServerResponse): Promise<void> {
  const now = Date.now();
  for (const [handle, login] of logins) {
    if (login.expiresAt > now) {
      break;
    }

    logins.delete(handle);
  }

  if (logins.size >= MAX_PENDING_LOGINS) {
    response.writeHead(UNAVAILABLE).end('Too many pending sign-ins. Try again later.');
    return;
  }

  const handle = oidc.randomState();
  const login = {
    verifier: oidc.randomPKCECodeVerifier(),
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    expiresAt: now + LOGIN_LIFETIME_MS,
  };
  const location = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: callback.href,
    response_type: 'code',
    scope: 'openid',
    state: login.state,
    nonce: login.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(login.verifier),
    code_challenge_method: 'S256',
  });

  logins.set(handle, login);
  response
    .writeHead(SEE_OTHER, {
      location: location.href,
      'set-cookie': loginCookie(handle, LOGIN_LIFETIME_MS / MILLISECONDS_PER_SECOND),
    })
    .end();
}

async function finishLogin(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const prefix = `${COOKIE_NAME}=`;
  const cookie = request.headers.cookie
    ?.split(';')
    .find((value) => value.trim().startsWith(prefix));
  const handle = cookie?.trim().slice(prefix.length) ?? '';
  const login = logins.get(handle);

  logins.delete(handle);
  response.setHeader('set-cookie', loginCookie('', EXPIRED));
  if (!login || login.expiresAt <= Date.now()) {
    response.writeHead(BAD_REQUEST).end('Sign-in expired. Start again.');
    return;
  }

  const tokens = await oidc.authorizationCodeGrant(configuration, url, {
    expectedState: login.state,
    expectedNonce: login.nonce,
    pkceCodeVerifier: login.verifier,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) {
    throw new Error('Missing ID token claims');
  }

  response
    .writeHead(OK, { 'content-type': 'application/json' })
    .end(JSON.stringify({ subject: claims.sub }));
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');

  const url = new URL(request.url ?? '/', settings.APP_ORIGIN);
  if (request.method !== 'GET' || url.origin !== settings.APP_ORIGIN) {
    response.writeHead(BAD_REQUEST).end();
    return;
  }

  if (url.pathname === '/sign-in') {
    await beginLogin(response);
    return;
  }

  if (url.pathname === '/callback') {
    await finishLogin(request, response, url);
    return;
  }

  if (url.pathname === '/') {
    response
      .writeHead(OK, { 'content-type': 'text/html; charset=utf-8' })
      .end('<a href="/sign-in">Sign in with IAM</a>');
    return;
  }

  response.writeHead(NOT_FOUND).end();
}

createServer((request, response) => {
  handleRequest(request, response).catch(() =>
    response.writeHead(BAD_REQUEST).end('Authorization failed.'),
  );
}).listen(Number(settings.PORT), '127.0.0.1');
