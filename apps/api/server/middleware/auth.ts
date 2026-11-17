import { useAuth } from '@iam/auth';
import { HTTPError, defineMiddleware } from 'nitro';
import { handleCors } from 'nitro/h3';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export default defineMiddleware(async (event, next) => {
  const pathname = event.url.pathname;

  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    return next();
  }

  event.res.headers.set('Cache-Control', 'no-store');
  const authContext = await useAuth().$context;
  const origin = event.req.headers.get('origin');
  if (origin && !authContext.isTrustedOrigin(origin, { allowRelativePaths: false })) {
    throw new HTTPError('Untrusted request origin', {
      status: 403,
      data: { code: 'FORBIDDEN_ORIGIN' },
    });
  }
  const preflight = handleCors(event, {
    origin: (requestOrigin) =>
      authContext.isTrustedOrigin(requestOrigin, { allowRelativePaths: false }),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
  if (preflight) {
    return preflight;
  }

  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    return next();
  }

  const sessionResult = await useAuth()
    .api.getSession({
      headers: event.req.headers,
      returnHeaders: true,
    })
    .catch(() => {
      console.error('AUTH_UNAVAILABLE');
      throw new HTTPError('Authentication unavailable', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
        data: { code: 'AUTH_UNAVAILABLE' },
      });
    });

  for (const cookie of sessionResult.headers.getSetCookie()) {
    event.res.headers.append('Set-Cookie', cookie);
  }

  if (!sessionResult.response) {
    throw new HTTPError('Authentication required', {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
      data: { code: 'UNAUTHORIZED' },
    });
  }

  if (!safeMethods.has(event.req.method) && !origin) {
    throw new HTTPError('Untrusted request origin', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
      data: { code: 'FORBIDDEN_ORIGIN' },
    });
  }
  return next();
});
