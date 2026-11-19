import type { H3Event } from 'nitro/h3';
import { assertBodySize, deleteCookie, getCookie, setCookie } from 'nitro/h3';
import { constants } from 'node:http2';
import { ClientSecretBasic as clientSecretBasic } from 'openid-client';
import * as oidc from 'openid-client';
import * as valibot from 'valibot';
import {
  consumeTransaction,
  createSession,
  createTransaction,
  deleteSession,
  readAccessToken,
  readSession,
} from '../repositories/session.repository.ts';
import { useEnv } from '../utils/env.ts';

const CLIENT_ID = 'iam-console';
const CALLBACK_PATH = '/api/v1/callback';
const LOGIN_COOKIE = '__Host-iam-console-login';
const SESSION_COOKIE = '__Host-iam-console-session';
const LOGIN_SECONDS = 600;
const MILLISECONDS_PER_SECOND = 1000;
const EXPIRED = 0;
const MEDIA_TYPE_INDEX = 0;
const MAX_SIGN_OUT_BYTES = 128;
const MAX_MANAGEMENT_BYTES = 16_384;
const MANAGEMENT_TIMEOUT_MS = 15_000;

const accountClaims = valibot.object({
  sub: valibot.pipe(valibot.string(), valibot.nonEmpty()),
  email: valibot.pipe(valibot.string(), valibot.email()),
  email_verified: valibot.literal(true),
  name: valibot.nullish(valibot.string(), null),
});

let configuration: Promise<oidc.Configuration> | null = null;

async function getConfiguration(): Promise<oidc.Configuration> {
  const env = useEnv();

  configuration ??= oidc
    .discovery(
      new URL(env.oidcIssuerUrl),
      CLIENT_ID,
      { id_token_signed_response_alg: 'RS256' },
      clientSecretBasic(env.oidcClientSecret),
      { execute: [oidc.enableNonRepudiationChecks] },
    )
    .catch(() => {
      configuration = null;
      throw new Error('The IAM issuer is unavailable.');
    });

  return configuration;
}

function prepareResponse(event: H3Event): void {
  event.res.headers.set('cache-control', 'no-store');
  event.res.headers.set('referrer-policy', 'no-referrer');
}

function setBrowserCookie(event: H3Event, name: string, value: string, maxAge: number): void {
  setCookie(event, name, value, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge,
  });
}

function clearCookie(event: H3Event, name: string): void {
  deleteCookie(event, name, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  });
}

/**
 * Begins a ten-minute authorization transaction bound to this browser.
 * @param {H3Event} event - Console navigation with an optional same-origin returnTo URL.
 * @returns {Promise<Response>} Redirect to hosted sign-in or an invalid destination response.
 */
export async function beginLogin(event: H3Event): Promise<Response> {
  prepareResponse(event);

  const env = useEnv();
  const destination = URL.parse(event.url.searchParams.get('returnTo') ?? '/', env.consoleOrigin);
  if (
    destination?.origin !== env.consoleOrigin ||
    destination.username ||
    destination.password ||
    destination.protocol !== 'https:'
  ) {
    return new Response('Invalid return destination.', {
      status: constants.HTTP_STATUS_BAD_REQUEST,
    });
  }

  const config = await getConfiguration();
  const cookie = oidc.randomState();
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const authorization = oidc.buildAuthorizationUrl(config, {
    redirect_uri: new URL(CALLBACK_PATH, env.consoleOrigin).href,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    state,
    nonce,
  });

  await createTransaction(cookie, {
    state,
    nonce,
    verifier,
    returnTo: destination.href,
    expiresAt: new Date(Date.now() + LOGIN_SECONDS * MILLISECONDS_PER_SECOND),
  });
  setBrowserCookie(event, LOGIN_COOKIE, cookie, LOGIN_SECONDS);

  return Response.redirect(authorization, constants.HTTP_STATUS_SEE_OTHER);
}

/**
 * Consumes the transaction and starts a session after validating the signed ID token.
 * @param {H3Event} event - Authorization response and the browser's transaction cookie.
 * @returns {Promise<Response>} Redirect to the original console page or a failed sign-in response.
 */
export async function finishLogin(event: H3Event): Promise<Response> {
  prepareResponse(event);

  const env = useEnv();
  const cookie = getCookie(event, LOGIN_COOKIE);
  const state = event.url.searchParams.get('state');
  const transaction = cookie && state ? await consumeTransaction(cookie, state) : null;
  if (!transaction || !state) {
    return new Response('Invalid or expired sign-in.', {
      status: constants.HTTP_STATUS_BAD_REQUEST,
    });
  }

  clearCookie(event, LOGIN_COOKIE);

  const config = await getConfiguration();
  const callback = new URL(CALLBACK_PATH, env.consoleOrigin);

  callback.search = event.url.search;

  const tokens = await oidc
    .authorizationCodeGrant(config, callback, {
      expectedState: state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.verifier,
      idTokenExpected: true,
    })
    .catch(() => null);
  const claims = tokens?.claims();
  const lifetime = tokens?.expiresIn();
  if (!tokens || !claims || !lifetime) {
    return new Response('Sign-in failed.', { status: constants.HTTP_STATUS_BAD_REQUEST });
  }

  const expiresAt = new Date(
    Math.min(claims.exp * MILLISECONDS_PER_SECOND, Date.now() + lifetime * MILLISECONDS_PER_SECOND),
  );
  const profile = await oidc
    .fetchUserInfo(config, tokens.access_token, claims.sub)
    .catch(() => null);
  const account = valibot.safeParse(accountClaims, profile);
  if (!account.success) {
    return new Response('Unable to verify account details.', {
      status: constants.HTTP_STATUS_BAD_REQUEST,
    });
  }

  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / MILLISECONDS_PER_SECOND);
  if (maxAge <= EXPIRED) {
    return new Response('Sign-in expired.', { status: constants.HTTP_STATUS_BAD_REQUEST });
  }

  const previous = getCookie(event, SESSION_COOKIE);
  const handle = oidc.randomState();
  const { sub, email, name } = account.output;

  await createSession(handle, { sub, email, name, expiresAt }, tokens.access_token, previous);
  setBrowserCookie(event, SESSION_COOKIE, handle, maxAge);

  return Response.redirect(transaction.returnTo, constants.HTTP_STATUS_SEE_OTHER);
}

/**
 * Reads the signed-in account for the console page.
 * @param {H3Event} event - Request carrying the console session cookie.
 * @returns {Promise<Response>} Account details or 401 when reauthorization is required.
 */
export async function getSession(event: H3Event): Promise<Response> {
  prepareResponse(event);

  const env = useEnv();
  const cookie = getCookie(event, SESSION_COOKIE);
  const user = cookie ? await readSession(cookie) : null;
  if (!user) {
    return new Response(null, { status: constants.HTTP_STATUS_UNAUTHORIZED });
  }

  return Response.json({
    user,
    issuer: env.oidcIssuerUrl,
  });
}

/**
 * Ends the local session and optionally redirects to the issuer's sign-out confirmation.
 * @param {H3Event} event - Same-origin form submission selecting app or IAM sign-out.
 * @returns {Promise<Response>} Redirect after the console session has been deleted.
 */
export async function signOut(event: H3Event): Promise<Response> {
  prepareResponse(event);

  const env = useEnv();
  if (event.req.headers.get('origin') !== env.consoleOrigin) {
    return new Response(null, { status: constants.HTTP_STATUS_FORBIDDEN });
  }

  if (
    event.req.headers.get('content-type')?.split(';').at(MEDIA_TYPE_INDEX) !==
    'application/x-www-form-urlencoded'
  ) {
    return new Response(null, { status: constants.HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE });
  }

  assertBodySize(event, MAX_SIGN_OUT_BYTES);

  const form = new URLSearchParams(await event.req.text());
  const scope = form.get('scope');
  if (scope !== 'app' && scope !== 'iam') {
    return new Response(null, { status: constants.HTTP_STATUS_BAD_REQUEST });
  }

  const cookie = getCookie(event, SESSION_COOKIE);
  if (cookie) {
    await deleteSession(cookie);
  }

  clearCookie(event, SESSION_COOKIE);
  clearCookie(event, LOGIN_COOKIE);

  const destination =
    scope === 'app'
      ? new URL('/signed-out', env.consoleOrigin)
      : new URL('/sign-out', env.oidcIssuerUrl);

  return Response.redirect(destination, constants.HTTP_STATUS_SEE_OTHER);
}

/**
 * Submits a same-origin management request under the console user's live IAM access token.
 * @param {H3Event} event - JSON request authenticated by the console cookie.
 * @returns {Promise<Response>} The IdP decision, or 401 if the console needs a new authorization.
 */
export async function manageOrganization(event: H3Event): Promise<Response> {
  prepareResponse(event);

  const env = useEnv();
  if (event.req.headers.get('origin') !== env.consoleOrigin) {
    return new Response(null, { status: constants.HTTP_STATUS_FORBIDDEN });
  }

  if (
    event.req.headers.get('content-type')?.split(';').at(MEDIA_TYPE_INDEX) !== 'application/json'
  ) {
    return new Response(null, { status: constants.HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE });
  }

  const cookie = getCookie(event, SESSION_COOKIE);
  const accessToken = cookie ? await readAccessToken(cookie) : null;
  if (!accessToken) {
    return new Response(null, { status: constants.HTTP_STATUS_UNAUTHORIZED });
  }

  assertBodySize(event, MAX_MANAGEMENT_BYTES);

  const headers = new Headers({
    'content-type': 'application/json',
    'x-iam-access-token': accessToken,
  });
  const authenticate = clientSecretBasic(env.oidcClientSecret);

  authenticate(
    { issuer: env.oidcIssuerUrl },
    { client_id: CLIENT_ID },
    new URLSearchParams(),
    headers,
  );

  const response = await fetch(new URL('/api/v1/management', env.oidcIssuerUrl), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
    headers,
    body: await event.req.text(),
  }).catch(() => null);

  if (!response) {
    return new Response(null, { status: constants.HTTP_STATUS_BAD_GATEWAY });
  }

  return new Response(response.ok ? response.body : null, {
    status: response.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
