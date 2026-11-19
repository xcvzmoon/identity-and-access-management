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

type Session = {
  accessToken: string;
  subject: string;
  expiresAt: number;
};

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const MAX_SESSIONS = 4096;
const SESSION_COOKIE = '__Host-iam-reference-session';
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
const liveAccessSchema = valibot.object({
  active: valibot.literal(true),
  client_id: valibot.literal(settings.CLIENT_ID),
  sub: valibot.string(),
  permissions: valibot.array(valibot.string()),
});
const sessions = new Map<string, Session>();
const logins = new Map<string, Login>();

function cookieValue(request: IncomingMessage, name: string): string {
  const prefix = `${name}=`;

  return (
    request.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? ''
  );
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
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
      'set-cookie': cookie(COOKIE_NAME, handle, LOGIN_LIFETIME_MS / MILLISECONDS_PER_SECOND),
    })
    .end();
}

function createSession(
  previousSession: string,
  accessToken: string,
  subject: string,
  lifetime: number,
): string | null {
  const now = Date.now();

  sessions.delete(previousSession);

  if (sessions.size >= MAX_SESSIONS) {
    for (const [sessionHandle, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(sessionHandle);
      }
    }
  }

  if (sessions.size >= MAX_SESSIONS) {
    return null;
  }

  const sessionHandle = oidc.randomState();

  sessions.set(sessionHandle, {
    accessToken,
    subject,
    expiresAt: now + lifetime * MILLISECONDS_PER_SECOND,
  });

  return sessionHandle;
}

async function finishLogin(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const handle = cookieValue(request, COOKIE_NAME);
  const login = logins.get(handle);

  logins.delete(handle);
  response.setHeader('set-cookie', cookie(COOKIE_NAME, '', EXPIRED));

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
  const lifetime = tokens.expiresIn();

  if (!claims || !lifetime || lifetime <= EXPIRED) {
    throw new Error('Missing ID token claims or access token lifetime');
  }

  const sessionHandle = createSession(
    cookieValue(request, SESSION_COOKIE),
    tokens.access_token,
    claims.sub,
    lifetime,
  );

  if (!sessionHandle) {
    response.writeHead(UNAVAILABLE).end('Too many active sessions. Try again later.');
    return;
  }

  const subject = encodeURIComponent(claims.sub);
  const report = `/reports/${subject}`;

  response.appendHeader('set-cookie', cookie(SESSION_COOKIE, sessionHandle, lifetime));

  if (request.headers.accept?.includes('text/html')) {
    response
      .writeHead(OK, { 'content-type': 'text/html; charset=utf-8' })
      .end(
        `<a href="${report}">View report for ${subject}</a> <a href="/sign-out">Sign out of IAM</a>`,
      );
    return;
  }

  response.writeHead(OK, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      subject: claims.sub,
      report,
      signOut: '/sign-out',
    }),
  );
}

async function serveReport(
  session: Session | undefined,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  if (!session || session.expiresAt <= Date.now()) {
    response.writeHead(UNAUTHORIZED).end();
    return;
  }

  try {
    const introspection = await oidc.tokenIntrospection(configuration, session.accessToken, {
      token_type_hint: 'access_token',
    });
    const access = valibot.safeParse(liveAccessSchema, introspection);

    if (!access.success || access.output.sub !== session.subject) {
      response.writeHead(UNAUTHORIZED).end();
      return;
    }

    if (
      !access.output.permissions.includes('reports.read') ||
      pathname !== `/reports/${encodeURIComponent(session.subject)}`
    ) {
      response.writeHead(FORBIDDEN).end();
      return;
    }

    response
      .writeHead(OK, { 'content-type': 'application/json' })
      .end(JSON.stringify({ owner: session.subject }));
  } catch {
    response.writeHead(UNAVAILABLE).end('IAM access check unavailable.');
  }
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

  if (url.pathname.startsWith('/reports/')) {
    const session = sessions.get(cookieValue(request, SESSION_COOKIE));
    await serveReport(session, url.pathname, response);
    return;
  }

  if (url.pathname === '/sign-out') {
    response
      .writeHead(SEE_OTHER, { location: new URL('/sign-out', settings.OIDC_ISSUER_URL).href })
      .end();
    return;
  }

  if (url.pathname === '/') {
    response
      .writeHead(OK, { 'content-type': 'text/html; charset=utf-8' })
      .end('<a href="/sign-in">Sign in with IAM</a> <a href="/sign-out">Sign out of IAM</a>');
    return;
  }

  response.writeHead(NOT_FOUND).end();
}

createServer((request, response) => {
  handleRequest(request, response).catch(() =>
    response.writeHead(BAD_REQUEST).end('Authorization failed.'),
  );
}).listen(Number(settings.PORT), '127.0.0.1');
