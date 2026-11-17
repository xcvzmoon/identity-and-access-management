import type { RequestEvent } from 'nuxt/schema';
import type { User } from '#auth-utils';
import { selectUserSchema } from '@iam/shared/types';
import { createError, useRuntimeConfig } from 'nuxt/server';
import { $fetch } from 'ofetch';
import * as valibot from 'valibot';

const unauthorized = 401;
const sessionSchema = valibot.nullable(
  valibot.object({ user: valibot.pick(selectUserSchema, ['id', 'name', 'email']) }),
);

/**
 * Resolves the API session and forwards any updated cookies.
 * @param {RequestEvent} event - Request to check and response to receive cookies.
 * @returns {Promise<User | null>} Verified user, or null when signed out.
 * @throws {Error} When the session API is unavailable or returns invalid data.
 */
export async function resolveApiSession(event: RequestEvent): Promise<User | null> {
  event.res.headers.set('Cache-Control', 'no-store');
  const cookie = selectApiCookies(event.req.headers.get('cookie'));
  if (!cookie) {
    return null;
  }

  const config = useRuntimeConfig();
  try {
    const response = await $fetch.raw<unknown, 'stream'>(
      new URL('/api/auth/get-session', config.public.apiUrl).href,
      {
        headers: { cookie },
        redirect: 'error',
        responseType: 'stream',
        ignoreResponseError: true,
        retry: 0,
      },
    );
    if (response.ok || response.status === unauthorized) {
      for (const sessionCookie of response.headers.getSetCookie()) {
        event.res.headers.append('Set-Cookie', sessionCookie);
      }
      if (response.status === unauthorized) {
        await response.body?.cancel();
        return null;
      }
      return valibot.parse(sessionSchema, await response.json())?.user ?? null;
    }
    await response.body?.cancel();
  } catch {
    throw createError({
      status: 503,
      message: 'Authentication unavailable',
    });
  }
  throw createError({
    status: 503,
    message: 'Authentication unavailable',
  });
}
