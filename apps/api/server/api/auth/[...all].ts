import type { H3Event } from 'nitro/h3';
import { HTTPError, defineHandler } from 'nitro';
import { assertBodySize } from 'nitro/h3';
import {
  authRequestHeaders,
  dispatchAuthRequest,
  emailSignInPath,
  emailSignUpPath,
  maxAuthBodyBytes,
  passwordRecoveryPath,
  requireBrowserOrigin,
} from '../../utils/auth-http.ts';

const maxRecoveryBodyBytes = 4096;
const authBodyLimits = new Map([[passwordRecoveryPath, maxRecoveryBodyBytes]]);

const publicAuthEndpoints = new Set([
  'GET /api/auth/get-session',
  `POST ${passwordRecoveryPath}`,
  'GET /api/auth/ok',
  'POST /api/auth/get-session',
  `POST ${emailSignUpPath}`,
  `POST ${emailSignInPath}`,
  'POST /api/auth/sign-out',
]);

async function readAuthRequest(event: H3Event): Promise<Request> {
  const headers = authRequestHeaders(event, event.req.headers);
  const { pathname } = event.url;

  if (event.req.method === 'POST') {
    assertBodySize(event, authBodyLimits.get(pathname) ?? maxAuthBodyBytes);
  }

  if (pathname === passwordRecoveryPath) {
    await requireBrowserOrigin(event);

    const [mediaType = ''] = (headers.get('content-type') ?? '').split(';');

    if (mediaType.trim().toLowerCase() !== 'application/json') {
      throw new HTTPError('Unsupported request encoding', { status: 415 });
    }
  }

  const { method, signal, url } = event.req;
  const body = method === 'POST' && event.req.body ? await event.req.arrayBuffer() : null;

  return new Request(url, {
    method,
    signal,
    headers,
    body,
  });
}

export default defineHandler(async (event) => {
  const { pathname } = event.url;
  const { method } = event.req;

  if (!publicAuthEndpoints.has(`${method} ${pathname}`)) {
    throw new HTTPError('Authentication endpoint not found', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  if (pathname === passwordRecoveryPath) {
    event.res.headers.set('Cache-Control', 'no-store');
  }

  return dispatchAuthRequest(await readAuthRequest(event));
});
