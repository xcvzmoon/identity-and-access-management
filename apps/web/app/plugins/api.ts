const unauthorized = 401;

export default defineNuxtPlugin({
  name: 'api',
  setup: (app) => {
    const runtimeConfig = useRuntimeConfig();
    const apiUrl = new URL(runtimeConfig.public.apiUrl);
    const event = useRequestEvent();
    const cookie = selectApiCookies(event?.req.headers.get('cookie') ?? null);
    const api = $fetch.create({
      baseURL: apiUrl.origin,
      credentials: 'include',
      retry: 0,
      onRequest: (context) => {
        if (context.request instanceof Request) {
          throw new TypeError('Use a path and fetch options for API requests.');
        }

        const target = new URL(context.request, apiUrl.origin);
        if (target.origin !== apiUrl.origin || target.username || target.password) {
          throw new TypeError('API requests must target the configured API origin.');
        }

        context.request = target.href;

        if (event) {
          context.options.redirect = 'error';
          if (cookie) {
            context.options.headers.set('cookie', cookie);
          }
        }
      },
      onResponse: (context) => {
        if (event) {
          for (const responseCookie of context.response.headers.getSetCookie()) {
            event.res.headers.append('Set-Cookie', responseCookie);
          }
        }
      },
      onResponseError: async (context) => {
        if (context.response.status !== unauthorized) {
          return;
        }

        const pathname = new URL(context.response.url).pathname;

        if (pathname !== '/api' && !pathname.startsWith('/api/')) {
          return;
        }

        if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
          return;
        }

        await app.runWithContext(async () => {
          useUserSession().session.value = null;

          const route = useRoute();

          if (route.path !== '/signin') {
            await navigateTo({
              path: '/signin',
              query: { redirect: route.fullPath },
            });
          }
        });
      },
    });

    return { provide: { api } };
  },
});
