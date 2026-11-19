import type { Dispatcher } from 'undici';
import { defineMiddleware, proxyRequest } from 'nitro/h3';
import { useRuntimeConfig } from 'nuxt/server';
import { getGlobalDispatcher } from 'undici';
import * as valibot from 'valibot';

const originSchema = valibot.pipe(
  valibot.string(),
  valibot.url(),
  valibot.transform((url) => new URL(url)),
  valibot.check((url) => url.protocol === 'http:' || url.protocol === 'https:'),
  valibot.transform((url) => url.origin),
);

const authPages = new Set(['/signin', '/signup', '/recover-password']);
const forwardingHeaders = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
];

function withHost(
  headers: Dispatcher.DispatchOptions['headers'],
  host: string,
): Dispatcher.DispatchOptions['headers'] {
  if (Array.isArray(headers)) {
    return [...headers, 'host', host];
  }
  if (headers && Symbol.iterator in headers) {
    return [...headers, ['host', host]];
  }

  return { ...headers, host };
}

export default defineMiddleware((event, next) => {
  const { pathname, search, host } = event.url;

  const pagePath = pathname.replace(/\/$/u, '');
  const apiRequest =
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/.well-known/openid-configuration';
  const config = useRuntimeConfig();
  if (authPages.has(pagePath) || pathname.startsWith('/oidc/')) {
    const destination = new URL(valibot.parse(originSchema, config.idpOrigin));
    destination.pathname = pathname;
    destination.search = search;
    return new Response(null, {
      status: 303,
      headers: {
        Location: destination.href,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  if (!apiRequest) {
    return next();
  }

  const upstream = new URL(valibot.parse(originSchema, config.apiUrl));
  upstream.pathname = pathname;
  upstream.search = search;

  const dispatcher = getGlobalDispatcher().compose((dispatch) => (options, handler): boolean => {
    return dispatch(
      {
        ...options,
        headers: withHost(options.headers, host),
      },
      handler,
    );
  });
  const fetchOptions = {
    dispatcher,
    redirect: 'manual',
  } satisfies RequestInit & { dispatcher: Dispatcher };

  return proxyRequest(event, upstream.href, {
    filterHeaders: forwardingHeaders,
    fetchOptions,
    locationRewrite: false,
  });
});
