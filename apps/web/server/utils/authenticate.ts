import type { RequestEvent } from 'nuxt/schema';
import { selectUserSchema } from '@iam/shared/types';
import { createError, getRequestIP, getRequestURL, readBody, useRuntimeConfig } from 'nuxt/server';
import { $fetch } from 'ofetch';
import * as valibot from 'valibot';

type AuthAction = 'sign-in' | 'sign-up';

const credentials = {
  email: valibot.pipe(valibot.string(), valibot.email()),
  password: valibot.pipe(valibot.string(), valibot.nonEmpty()),
};
const signInSchema = valibot.object(credentials);
const signUpSchema = valibot.object({
  ...credentials,
  name: valibot.pipe(valibot.string(), valibot.nonEmpty()),
});
const responseSchema = valibot.object({
  user: valibot.pick(selectUserSchema, ['id', 'name', 'email']),
});
const serverError = 500;
const unavailable = 503;

function authRequestHeaders(event: RequestEvent): Headers {
  event.res.headers.set('Cache-Control', 'no-store');
  const origin = event.req.headers.get('origin');
  if (origin !== getRequestURL(event).origin) {
    throw createError({
      status: 403,
      message: 'Untrusted request origin',
    });
  }

  const headers = new Headers({ origin });
  const clientIp = getRequestIP(event);
  if (clientIp) {
    headers.set('X-Forwarded-For', clientIp);
  }
  return headers;
}

async function postAuth(
  path: `/api/auth/${AuthAction}/email` | '/api/auth/sign-out',
  headers: Headers,
  body?: valibot.InferOutput<typeof signInSchema | typeof signUpSchema>,
): Promise<Response> {
  const config = useRuntimeConfig();
  const apiUrl = config.apiUrl === '' ? config.public.apiUrl : config.apiUrl;
  const response = await $fetch
    .raw<unknown, 'stream'>(new URL(path, apiUrl).href, {
      method: 'POST',
      headers,
      body: body ?? {},
      redirect: 'error',
      responseType: 'stream',
      ignoreResponseError: true,
      retry: 0,
    })
    .catch(() => {
      throw createError({
        status: unavailable,
        message: 'Authentication unavailable',
      });
    });
  if (!response.ok) {
    await response.body?.cancel();
    throw createError({
      status: response.status < serverError ? response.status : unavailable,
      message:
        response.status < serverError ? 'Authentication failed' : 'Authentication unavailable',
    });
  }

  return response;
}

function forwardAuthCookies(event: RequestEvent, response: Response): void {
  for (const cookie of response.headers.getSetCookie()) {
    event.res.headers.append('Set-Cookie', cookie);
  }
}

/**
 * Exchanges credentials for the API and Nuxt session cookies.
 * @param {RequestEvent} event - Same-origin web request containing credentials.
 * @param {AuthAction} action - Better Auth operation to call.
 * @returns {Promise<void>} Resolves once both cookies are ready to send.
 * @throws {Error} When the request is invalid or Better Auth rejects it.
 */
export async function authenticate(event: RequestEvent, action: AuthAction): Promise<void> {
  const headers = authRequestHeaders(event);
  const body = valibot.safeParse(
    action === 'sign-in' ? signInSchema : signUpSchema,
    await readBody(event),
  );
  if (!body.success) {
    throw createError({
      status: 400,
      message: 'Invalid credentials input',
    });
  }

  const response = await postAuth(`/api/auth/${action}/email`, headers, body.output);

  const session = valibot.parse(responseSchema, await response.json());
  await replaceUserSession(event, { user: session.user });
  forwardAuthCookies(event, response);
}

/**
 * Revokes the API session before clearing the sealed web session.
 * @param {RequestEvent} event - Same-origin sign-out request.
 * @returns {Promise<void>} Resolves once both cookies have been cleared.
 * @throws {Error} When the origin is rejected or API sign-out fails.
 */
export async function signOut(event: RequestEvent): Promise<void> {
  const headers = authRequestHeaders(event);
  const cookie = selectApiCookies(event.req.headers.get('cookie'));
  if (cookie) {
    headers.set('Cookie', cookie);
  }
  const response = await postAuth('/api/auth/sign-out', headers);
  await response.body?.cancel();
  await clearUserSession(event);
  forwardAuthCookies(event, response);
}
