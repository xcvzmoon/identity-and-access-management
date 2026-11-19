import type { Server, ServerOptions } from 'node:https';
import type { Pool } from 'pg';
import type { Provider } from './provider.ts';
import { toNodeHandler } from 'better-auth/node';
import { createServer } from 'node:https';
import * as valibot from 'valibot';
import { acceptInvitation, authPath, handleProtocol, requireStepUp, signUp } from './provider.ts';

const seeOther = 303;
const ephemeralPort = 0;
const firstRow = 0;
const badRequest = 400;
const internalError = 500;
const interactionSchema = valibot.object({
  url: valibot.string(),
  redirect: valibot.literal(true),
});

type Handler = (request: Request) => Promise<Response>;

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function interactionPage(url: URL, isLogin: boolean, name: string): Response {
  const title = isLogin ? 'Sign in' : 'Confirm application access';
  const fields = isLogin
    ? '<label>Email <input name="email" type="email" required></label><label>Password <input name="password" type="password" required></label>'
    : '';
  const submit = isLogin ? 'Sign in' : 'Allow';
  const page = `<h1>${title}</h1><p>${escape(name)}</p><form method="post">
    <input type="hidden" name="oauth_query" value="${escape(url.searchParams.toString())}">
    ${fields}<button>${submit}</button></form>`;
  return new Response(page, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function submitInteraction(
  request: Request,
  auth: Provider,
  isLogin: boolean,
): Promise<Response> {
  const form = await request.formData();
  const oauthQuery = form.get('oauth_query');
  const path = isLogin ? '/sign-in/email' : '/oauth2/consent';
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const response = await auth.handler(
    new Request(new URL(`${authPath}${path}`, request.url), {
      method: 'POST',
      headers,
      body: JSON.stringify(
        isLogin
          ? {
              email: form.get('email'),
              password: form.get('password'),
              oauth_query: oauthQuery,
            }
          : {
              accept: true,
              oauth_query: oauthQuery,
            },
      ),
    }),
  );
  if (!response.ok) {
    return response;
  }
  const redirect = valibot.parse(interactionSchema, await response.json());
  const redirectHeaders = new Headers({
    location: redirect.url,
    'cache-control': 'no-store',
  });
  for (const cookie of response.headers.getSetCookie()) {
    redirectHeaders.append('set-cookie', cookie);
  }
  return new Response(null, {
    status: seeOther,
    headers: redirectHeaders,
  });
}

/**
 * Start a localhost HTTPS listener. The caller closes the server.
 * @param {ServerOptions} tls - Fixture certificate and key.
 * @returns {Promise<object>} The listener and a method to mount its handler.
 */
export async function listen(tls: ServerOptions): Promise<{
  server: Server;
  port: number;
  setHandler: (handler: Handler) => void;
}> {
  const server = createServer(tls);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(ephemeralPort, '127.0.0.1', resolve);
  });
  const address = valibot.safeParse(valibot.object({ port: valibot.number() }), server.address());
  if (!address.success) {
    server.close();
    throw new Error('Expected the fixture to listen on a TCP port.');
  }
  return {
    server,
    port: address.output.port,
    setHandler: (handler) => {
      const handleRequest = toNodeHandler(async (request) => {
        try {
          return await handler(request);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Fixture handler failed.';
          process.stderr.write(`${message}\n`);
          return new Response('Fixture handler failed.', { status: internalError });
        }
      });
      server.on('request', (request, response) => {
        handleRequest(request, response).catch(() => response.destroy());
      });
    },
  };
}

/**
 * Route hosted interactions and protocol requests on one IdP origin.
 * @param {Request} request - Incoming request.
 * @param {Provider} auth - Local Better Auth instance.
 * @param {Pool} pool - Connection pool for IAM policy lookups.
 * @returns {Promise<Response>} The hosted page, redirect, or protocol response.
 */
export async function dispatchProvider(
  request: Request,
  auth: Provider,
  pool: Pool,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/sign-in' || url.pathname === '/consent') {
    const isLogin = url.pathname === '/sign-in';
    if (request.method === 'POST') {
      return submitInteraction(request, auth, isLogin);
    }
    const { rows } = await pool.query<{ name: string }>(
      'select name from evaluation_clients where id = $1',
      [url.searchParams.get('client_id')],
    );
    return interactionPage(url, isLogin, rows.at(firstRow)?.name ?? 'Registered application');
  }
  if (request.method === 'POST' && url.pathname === '/invitation/sign-up') {
    return signUp(request, auth, pool);
  }
  if (request.method === 'POST' && url.pathname === '/invitation/accept') {
    return acceptInvitation(request, auth, pool);
  }
  if (request.method === 'GET' && url.pathname === '/admin/step-up') {
    return requireStepUp(request, auth, pool);
  }
  if (url.pathname === '/' && request.method === 'GET') {
    return new Response('IAM evaluation');
  }
  if (
    !url.pathname.startsWith(`${authPath}/`) &&
    url.pathname !== '/.well-known/openid-configuration'
  ) {
    return new Response(null, { status: badRequest });
  }
  return handleProtocol(request, auth, pool);
}
