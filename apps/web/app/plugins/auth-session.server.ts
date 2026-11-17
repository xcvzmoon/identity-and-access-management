import type { UserSession } from '#auth-utils';

const unauthorized = 401;

export default defineNuxtPlugin(async () => {
  const event = useRequestEvent();
  const session = useUserSession();

  event?.res.headers.set('Cache-Control', 'no-store');

  const result = await useRequestFetch()<UserSession>('/api/_auth/session', {
    ignoreResponseError: true,
    retry: 0,
    onResponse: (context) => {
      if (event) {
        for (const cookie of context.response.headers.getSetCookie()) {
          event.res.headers.append('Set-Cookie', cookie);
        }
      }

      if (!context.response.ok && context.response.status !== unauthorized) {
        throw createError({
          status: 503,
          message: 'Authentication unavailable',
        });
      }
    },
  });

  session.session.value = result.user ? result : null;
});
