import type { H3Event } from 'nitro/h3';
import { useAuth } from '@iam/auth';
import { HTTPError } from 'nitro';
import * as valibot from 'valibot';
import { postAuth } from './auth-http.ts';

type SignedRequest = {
  query: string;
  clientId: string;
  callback: URL;
};

const serverError = 500;
const unavailable = 503;
const accessDenied = 403;
const maxRequestLength = 8192;
const clientSchema = valibot.object({
  client_name: valibot.pipe(valibot.string(), valibot.nonEmpty()),
});
const redirectSchema = valibot.object({
  redirect: valibot.literal(true),
  url: valibot.pipe(valibot.string(), valibot.url()),
});

export function readOidcRequest(query: string | null): SignedRequest {
  const params = new URLSearchParams(query ?? '');
  const clientId = params.get('client_id');
  const callback = params.get('redirect_uri');
  if (
    !query ||
    query.length > maxRequestLength ||
    !clientId ||
    !callback ||
    !params.has('sig') ||
    !URL.canParse(callback)
  ) {
    throw new HTTPError('Restart sign-in from the application', { status: 400 });
  }

  return {
    query,
    clientId,
    callback: new URL(callback),
  };
}

export async function getOidcClientName(event: H3Event, request: SignedRequest): Promise<string> {
  const upstream = await postAuth(event, '/api/auth/oauth2/public-client-prelogin', new Headers(), {
    client_id: request.clientId,
    oauth_query: request.query,
  });
  const client = upstream.ok ? valibot.safeParse(clientSchema, await upstream.json()) : null;
  if (!client?.success) {
    if (!upstream.ok) {
      await upstream.body?.cancel();
    }

    throw new HTTPError('Restart sign-in from the application', { status: 400 });
  }

  return client.output.client_name;
}

async function redirectFromProvider(upstream: Response, destination: URL): Promise<Response> {
  const context = await useAuth().$context;
  if (
    (destination.protocol !== 'https:' &&
      !context.isTrustedOrigin(destination.origin, { allowRelativePaths: false })) ||
    destination.username ||
    destination.password
  ) {
    throw new HTTPError('Authentication unavailable', { status: unavailable });
  }

  const headers = new Headers({ Location: destination.href });
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append('Set-Cookie', cookie);
  }

  const seeOther = 303;
  return new Response(null, {
    status: seeOther,
    headers,
  });
}

export async function authorizeOidcResponse(upstream: Response): Promise<Response> {
  if (upstream.status === accessDenied) {
    await upstream.body?.cancel();
    throw new HTTPError('Application access denied', { status: accessDenied });
  }

  if (!upstream.ok) {
    return upstream;
  }

  const target = valibot.safeParse(redirectSchema, await upstream.json());
  if (!target.success) {
    throw new HTTPError('Authentication unavailable', { status: unavailable });
  }

  return redirectFromProvider(upstream, new URL(target.output.url));
}

export async function redirectOidcInteraction(
  upstream: Response,
  request: SignedRequest,
): Promise<Response> {
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const clientError = upstream.status < serverError;
    throw new HTTPError(
      upstream.status === accessDenied
        ? 'Application access denied'
        : 'Sign-in could not be completed',
      { status: clientError ? upstream.status : unavailable },
    );
  }

  const result = valibot.safeParse(redirectSchema, await upstream.json());
  if (!result.success) {
    throw new HTTPError('Restart sign-in from the application', { status: 400 });
  }

  const destination = new URL(result.output.url);
  const context = await useAuth().$context;
  const internal =
    context.isTrustedOrigin(destination.origin, { allowRelativePaths: false }) &&
    destination.pathname === '/oidc/consent';
  const callback =
    destination.protocol === 'https:' &&
    destination.origin === request.callback.origin &&
    destination.pathname === request.callback.pathname &&
    !destination.username &&
    !destination.password;

  if (!internal && !callback) {
    throw new HTTPError('Authentication unavailable', { status: 503 });
  }

  return redirectFromProvider(upstream, destination);
}
