import type { H3Event } from 'nitro/h3';
import { useAuth } from '@iam/auth';
import { HTTPError } from 'nitro';
import { getRequestIP } from 'nitro/h3';
import { isIP } from 'node:net';
import * as valibot from 'valibot';
import { auditAuthRequest } from './auth-audit.ts';

export const emailSignInPath = '/api/auth/sign-in/email';
export const emailSignUpPath = '/api/auth/sign-up/email';
export const passwordRecoveryPath = '/api/auth/account/password-recovery';

export const maxAuthBodyBytes = 32_768;
type AuthPostPath =
  | typeof emailSignInPath
  | typeof emailSignUpPath
  | '/api/auth/sign-out'
  | '/api/auth/oauth2/consent'
  | '/api/auth/oauth2/public-client-prelogin';
type AuthPostBody =
  | { email: string; password: string; name?: string; oauth_query?: string }
  | { client_id: string; oauth_query: string }
  | { accept: boolean; oauth_query: string };
const userView = valibot.object({
  id: valibot.string(),
  email: valibot.string(),
  name: valibot.string(),
  emailVerified: valibot.boolean(),
});
const sessionView = valibot.nullable(valibot.object({ user: userView }));
const signInView = valibot.object({
  user: valibot.optional(userView),
  url: valibot.nullish(valibot.string()),
  redirect: valibot.optional(valibot.boolean()),
});

export function authRequestHeaders(event: H3Event, source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete('X-Forwarded-For');
  const clientIp = getRequestIP(event);
  if (clientIp && isIP(clientIp)) {
    headers.set('X-Forwarded-For', clientIp);
  }

  return headers;
}

export async function requireBrowserOrigin(event: H3Event): Promise<string> {
  const origin = event.req.headers.get('origin');
  const context = await useAuth().$context;

  if (!origin || !context.isTrustedOrigin(origin, { allowRelativePaths: false })) {
    throw new HTTPError('Untrusted request origin', { status: 403 });
  }

  return origin;
}

export function requireForm(event: H3Event): void {
  const [mediaType = ''] = (event.req.headers.get('content-type') ?? '').split(';');
  if (mediaType.trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    throw new HTTPError('Unsupported form encoding', { status: 415 });
  }
}

export function setOidcHeaders(event: H3Event): void {
  event.res.headers.set('Cache-Control', 'no-store');
  event.res.headers.set('Referrer-Policy', 'no-referrer');
}

async function projectAuthResponse(
  response: Response,
  view: typeof sessionView | typeof signInView,
): Promise<Response> {
  const result = valibot.parse(view, await response.json());
  const headers = new Headers(response.headers);

  headers.delete('Content-Length');

  return Response.json(result, {
    headers,
    status: response.status,
  });
}

export async function dispatchAuthRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method === 'POST' && pathname === emailSignInPath) {
    const response = await auditAuthRequest(request, 'AUTH_EMAIL_SIGN_IN');
    return response.ok ? projectAuthResponse(response, signInView) : response;
  }

  if (request.method === 'POST' && pathname === passwordRecoveryPath) {
    return auditAuthRequest(request, 'AUTH_PASSWORD_RECOVERY');
  }

  const response = await useAuth().handler(request);
  if (request.method === 'POST' && pathname === emailSignUpPath && response.ok) {
    await response.body?.cancel();
    return Response.json({}, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (pathname === '/api/auth/get-session' && response.ok) {
    return projectAuthResponse(response, sessionView);
  }

  return response;
}

export async function postAuth(
  event: H3Event,
  path: AuthPostPath,
  headers: Headers,
  body?: AuthPostBody,
): Promise<Response> {
  const context = await useAuth().$context;

  headers.set('Content-Type', 'application/json');

  const request = new Request(new URL(path, context.baseURL), {
    method: 'POST',
    headers: authRequestHeaders(event, headers),
    body: JSON.stringify(body ?? {}),
    signal: event.req.signal,
  });

  return dispatchAuthRequest(request);
}
