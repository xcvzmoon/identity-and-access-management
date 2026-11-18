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
  requireForm,
  setOidcHeaders,
} from '../../utils/auth-http.ts';
import { authorizeOidcResponse } from '../../utils/oidc-interaction.ts';

const maxRecoveryBodyBytes = 4096;
const maxUserInfoBodyBytes = 4096;
const maxAuthorizationQueryLength = 8192;
const authorizationPath = '/api/auth/oauth2/authorize';
const invitationsPath = '/api/auth/account/organization-invitations';
const userInfoPath = '/api/auth/oauth2/userinfo';
const serverProtocolPaths = new Set([
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/introspect',
  '/api/auth/oauth2/revoke',
]);

const authBodyLimits = new Map([
  [passwordRecoveryPath, maxRecoveryBodyBytes],
  [invitationsPath, maxRecoveryBodyBytes],
  [userInfoPath, maxUserInfoBodyBytes],
]);

const publicAuthEndpoints = new Set([
  'GET /api/auth/get-session',
  'POST /api/auth/admin/interaction',
  'POST /api/auth/admin/access',
  'POST /api/auth/admin/member-status',
  'POST /api/auth/admin/member-role',
  'POST /api/auth/admin/transfer-ownership',
  `POST ${passwordRecoveryPath}`,
  `POST ${invitationsPath}`,
  'GET /api/auth/ok',
  'GET /api/auth/machine/installation',
  'GET /api/auth/jwks',
  `GET ${authorizationPath}`,
  `POST ${authorizationPath}`,
  'POST /api/auth/oauth2/consent',
  'POST /api/auth/oauth2/public-client-prelogin',
  'POST /api/auth/oauth2/token',
  'POST /api/auth/oauth2/introspect',
  'POST /api/auth/oauth2/revoke',
  `GET ${userInfoPath}`,
  `POST ${userInfoPath}`,
  'POST /api/auth/get-session',
  `POST ${emailSignUpPath}`,
  `POST ${emailSignInPath}`,
  'POST /api/auth/sign-out',
]);

function protocolHeaders(event: H3Event): Headers {
  const { pathname, search } = event.url;
  const headers = authRequestHeaders(event, event.req.headers);

  if (serverProtocolPaths.has(pathname)) {
    if (headers.has('origin')) {
      throw new HTTPError('This endpoint requires a server request', { status: 403 });
    }

    requireForm(event);
    headers.delete('Cookie');
  }

  if (pathname === userInfoPath) {
    if (event.req.method === 'POST' && headers.has('content-type')) {
      requireForm(event);
    }

    headers.delete('Cookie');
  }

  if (pathname === authorizationPath) {
    if (search.length > maxAuthorizationQueryLength) {
      throw new HTTPError('Authorization request is too long', { status: 414 });
    }

    if (event.req.method === 'POST') {
      requireForm(event);
    }

    headers.set('Accept', 'text/html');
    headers.delete('Authorization');
  }

  return headers;
}

async function readAuthRequest(event: H3Event): Promise<Request> {
  const headers = protocolHeaders(event);
  const { pathname } = event.url;

  if (event.req.method === 'POST') {
    assertBodySize(event, authBodyLimits.get(pathname) ?? maxAuthBodyBytes);
  }

  if (
    pathname.startsWith('/api/auth/admin/') ||
    pathname === passwordRecoveryPath ||
    pathname === invitationsPath
  ) {
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
    body: pathname === userInfoPath && !body?.byteLength ? null : body,
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

  if (pathname === passwordRecoveryPath || pathname === invitationsPath) {
    event.res.headers.set('Cache-Control', 'no-store');
  }

  if (pathname.startsWith('/api/auth/oauth2/') || pathname === '/api/auth/jwks') {
    setOidcHeaders(event);
  }

  const response = await dispatchAuthRequest(await readAuthRequest(event));
  return pathname === authorizationPath ? authorizeOidcResponse(response) : response;
});
