import { HTTPError, defineMiddleware, getRequestIP } from 'nitro/h3';
import { useRuntimeConfig } from 'nuxt/server';
import * as valibot from 'valibot';
import { apiOrigin } from '../utils/api-origin.ts';

const clientSchema = valibot.object({
  callbackOrigin: valibot.pipe(valibot.string(), valibot.url()),
});

export default defineMiddleware(async (event, next) => {
  const { pathname, searchParams } = event.url;
  if (!pathname.startsWith('/oidc/')) {
    return next();
  }

  if (pathname !== '/oidc/login' && pathname !== '/oidc/consent') {
    throw new HTTPError('Page not found', { status: 404 });
  }

  const upstream = new URL('/api/oidc/client', apiOrigin());
  upstream.searchParams.set('request', searchParams.toString());
  const headers = new Headers();
  const clientIp = getRequestIP(event);
  if (clientIp) {
    headers.set('X-Forwarded-For', clientIp);
  }

  const response = await fetch(upstream, {
    headers,
    redirect: 'error',
    signal: event.req.signal,
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPError('Restart sign-in from the application', { status: response.status });
  }

  const client = valibot.parse(clientSchema, await response.json());
  const callbackOrigin = new URL(client.callbackOrigin).origin;
  const apiPublicOrigin = new URL(useRuntimeConfig().public.webOrigin).origin;
  const formOrigins = new Set([apiPublicOrigin, callbackOrigin]);
  formOrigins.delete(event.url.origin);
  event.res.headers.set(
    'Content-Security-Policy',
    `frame-ancestors 'none'; base-uri 'none'; form-action ${["'self'", ...formOrigins].join(' ')}`,
  );

  return next();
});
