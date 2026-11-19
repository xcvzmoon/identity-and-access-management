import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import * as oidc from 'openid-client';

const sessionCookie = '__Host-reference_session';
const transactionCookie = '__Host-reference_login';
const cookieAttributes = 'Secure; HttpOnly; SameSite=Lax; Path=/';
const callbackPath = '/callback';
const permission = 'reports.read';
const maxEntries = 1000;
const expired = 0;
const lifetimeSeconds = 300;
const millisecondsPerSecond = 1000;
const identifierBytes = 32;
const httpsPort = 443;
const ok = 200;
const seeOther = 303;
const badRequest = 400;
const unauthorized = 401;
const forbidden = 403;
const notFound = 404;
const unavailable = 503;

type Login = {
  verifier: string;
  state: string;
  nonce: string;
  expires: number;
};

type Session = {
  accessToken: string;
  subject: string;
  expires: number;
};

type ReferenceApp = {
  client: oidc.Configuration;
  origin: URL;
  logins: Map<string, Login>;
  sessions: Map<string, Session>;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} before starting the reference app.`);
  }

  return value;
}

function now(): number {
  return Math.floor(Date.now() / millisecondsPerSecond);
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; ${cookieAttributes}; Max-Age=${maxAge}`;
}

function cookieValue(request: IncomingMessage, name: string): string {
  const prefix = `${name}=`;
  const pair = request.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return pair?.slice(prefix.length) ?? '';
}

function sessionFor(app: ReferenceApp, request: IncomingMessage): Session | null {
  const session = app.sessions.get(cookieValue(request, sessionCookie));
  return session && session.expires > now() ? session : null;
}

function hasCapacity(entries: Map<string, { expires: number }>): boolean {
  const time = now();

  for (const [key, entry] of entries) {
    if (entry.expires <= time) {
      entries.delete(key);
    }
  }

  return entries.size < maxEntries;
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(seeOther, { location });
  response.end();
}

function text(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function home(response: ServerResponse, session: Session | null): void {
  const actions = session
    ? '<p><a href="/reports">Read reports</a></p><form method="post" action="/signout"><button>Sign out</button></form>'
    : '<form method="post" action="/signin"><button>Sign in with IAM</button></form>';
  response.setHeader('referrer-policy', 'same-origin');
  response.writeHead(ok, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reports reference app</title></head>
<body><main><h1>Reports reference app</h1>${actions}</main></body>
</html>`);
}

async function signIn(
  app: ReferenceApp,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  app.logins.delete(cookieValue(request, transactionCookie));

  if (!hasCapacity(app.logins)) {
    text(response, unavailable, 'Sign-in is busy. Try again shortly.');
    return;
  }

  const login: Login = {
    verifier,
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    expires: now() + lifetimeSeconds,
  };
  const authorization = oidc.buildAuthorizationUrl(app.client, {
    redirect_uri: new URL(callbackPath, app.origin).href,
    scope: 'openid',
    state: login.state,
    nonce: login.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const key = randomBytes(identifierBytes).toString('base64url');
  app.logins.set(key, login);
  response.setHeader('set-cookie', cookie(transactionCookie, key, lifetimeSeconds));
  redirect(response, authorization.href);
}

async function callback(
  app: ReferenceApp,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const key = cookieValue(request, transactionCookie);
  const login = app.logins.get(key);
  app.logins.delete(key);
  const clearLogin = cookie(transactionCookie, '', expired);
  response.setHeader('set-cookie', clearLogin);

  if (!login || login.expires <= now()) {
    text(response, badRequest, 'Sign-in expired. Return to the home page to start again.');
    return;
  }

  const token = await oidc
    .authorizationCodeGrant(app.client, url, {
      pkceCodeVerifier: login.verifier,
      expectedState: login.state,
      expectedNonce: login.nonce,
      idTokenExpected: true,
    })
    .catch(() => null);
  const claims = token?.claims();
  if (
    !token ||
    !claims ||
    !token.expires_in ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= expired
  ) {
    text(
      response,
      unauthorized,
      'Sign-in could not be completed. Return to the home page to try again.',
    );
    return;
  }

  app.sessions.delete(cookieValue(request, sessionCookie));

  if (!hasCapacity(app.sessions)) {
    text(response, unavailable, 'Sign-in is busy. Try again shortly.');
    return;
  }

  const sessionKey = randomBytes(identifierBytes).toString('base64url');
  const maxAge = Math.min(token.expires_in, lifetimeSeconds);
  app.sessions.set(sessionKey, {
    accessToken: token.access_token,
    subject: claims.sub,
    expires: now() + maxAge,
  });
  response.setHeader('set-cookie', [clearLogin, cookie(sessionCookie, sessionKey, maxAge)]);
  redirect(response, '/');
}

async function reports(
  app: ReferenceApp,
  session: Session | null,
  response: ServerResponse,
): Promise<void> {
  if (!session) {
    text(response, unauthorized, 'Sign in to read reports.');
    return;
  }

  const status = await oidc.tokenIntrospection(app.client, session.accessToken);
  const issuer = app.client.serverMetadata().issuer;
  const clientId = app.client.clientMetadata().client_id;
  if (
    !status.active ||
    status.iss !== issuer ||
    status.client_id !== clientId ||
    status.sub !== session.subject ||
    !status.exp ||
    status.exp <= now()
  ) {
    text(response, unauthorized, 'Your access ended. Sign in again.');
    return;
  }

  if (!Array.isArray(status.permissions) || !status.permissions.includes(permission)) {
    text(response, forbidden, 'You need the reports.read permission.');
    return;
  }

  text(response, ok, 'You have permission to read reports.');
}

async function signOut(
  app: ReferenceApp,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const session = sessionFor(app, request);
  app.sessions.delete(cookieValue(request, sessionCookie));
  app.logins.delete(cookieValue(request, transactionCookie));
  response.setHeader('set-cookie', [
    cookie(sessionCookie, '', expired),
    cookie(transactionCookie, '', expired),
  ]);

  if (session) {
    await oidc.tokenRevocation(app.client, session.accessToken, {
      token_type_hint: 'access_token',
    });
  }

  redirect(response, '/');
}

async function handle(
  app: ReferenceApp,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', app.origin);
  if (request.headers.host !== app.origin.host || url.origin !== app.origin.origin) {
    text(response, badRequest, 'Invalid request host.');
    return;
  }

  if (request.method === 'POST' && request.headers.origin !== app.origin.origin) {
    text(response, forbidden, 'Invalid request origin.');
    return;
  }

  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /') {
    home(response, sessionFor(app, request));
    return;
  }

  if (route === 'POST /signin') {
    await signIn(app, request, response);
    return;
  }

  if (route === 'GET /callback') {
    await callback(app, request, response, url);
    return;
  }

  if (route === 'GET /reports') {
    await reports(app, sessionFor(app, request), response);
    return;
  }

  if (route === 'POST /signout') {
    await signOut(app, request, response);
    return;
  }

  text(response, notFound, 'Page not found.');
}

function listener(app: ReferenceApp): RequestListener {
  const issuerOrigin = new URL(app.client.serverMetadata().issuer).origin;
  return (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader(
      'content-security-policy',
      `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' ${issuerOrigin}`,
    );
    handle(app, request, response).catch(() => {
      text(response, unavailable, 'Request could not be completed. Try again shortly.');
    });
  };
}

async function discover(issuer: URL): Promise<oidc.Configuration> {
  const execute = [oidc.enableNonRepudiationChecks];

  if (
    issuer.protocol === 'http:' &&
    (issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1')
  ) {
    // The SDK allows HTTP discovery and requests for the local development issuer.
    // oxlint-disable-next-line typescript/no-deprecated
    execute.unshift(oidc.allowInsecureRequests);
  }

  const method = process.env.OIDC_CLIENT_AUTH_METHOD ?? 'client_secret_basic';
  if (method !== 'client_secret_basic' && method !== 'client_secret_post') {
    throw new Error('Set OIDC_CLIENT_AUTH_METHOD to the method used at registration.');
  }

  const { ClientSecretBasic: clientSecretBasic, ClientSecretPost: clientSecretPost } = oidc;
  const authenticate = method === 'client_secret_post' ? clientSecretPost : clientSecretBasic;
  const secret = env('OIDC_CLIENT_SECRET');
  return oidc.discovery(issuer, env('OIDC_CLIENT_ID'), secret, authenticate(secret), {
    execute,
  });
}

async function main(): Promise<void> {
  const origin = new URL(env('REFERENCE_ORIGIN'));
  const issuer = new URL(env('OIDC_ISSUER'));
  if (
    origin.href !== `${origin.origin}/` ||
    origin.protocol !== 'https:' ||
    origin.hostname === issuer.hostname
  ) {
    throw new Error('Use an HTTPS reference origin with a hostname distinct from the issuer.');
  }

  const [client, key, cert] = await Promise.all([
    discover(issuer),
    readFile(env('REFERENCE_TLS_KEY')),
    readFile(env('REFERENCE_TLS_CERT')),
  ]);
  const server = createServer(
    { key, cert },
    listener({
      client,
      origin,
      logins: new Map(),
      sessions: new Map(),
    }),
  );
  server.listen(Number(origin.port || httpsPort), '127.0.0.1', () => {
    process.stdout.write(`Reference app listening at ${origin.origin}\n`);
  });
}

await main().catch(() => {
  process.stderr.write(
    'Could not start the reference app. Check the issuer, client, HTTPS origin, and TLS files.\n',
  );
  process.exitCode = 1;
});
