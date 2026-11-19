import type { H3Event } from 'nitro/h3';
import { metadataResponse } from '@better-auth/oauth-provider';
import { assertBodySize, getRequestIP } from 'nitro/h3';
import { isIP } from 'node:net';
import { useAuth } from '../utils/auth.ts';
import { useEnv } from '../utils/env.ts';
import { ForbiddenError, UnsupportedMediaTypeError } from '../utils/http-errors.ts';

const MEDIA_TYPE_INDEX = 0;
const MAX_AUTH_BODY_BYTES = 16_384;

/**
 * Applies the 16 KiB body limit and checks the origin and media type before body parsing.
 *
 * @param {H3Event} event - Incoming auth POST request.
 * @throws {ForbiddenError} When the Origin header is missing or differs from the issuer origin.
 * @throws {UnsupportedMediaTypeError} When the media type is not application/json.
 */
export function checkAuthPost(event: H3Event): void {
  const env = useEnv();

  assertBodySize(event, MAX_AUTH_BODY_BYTES);

  if (event.req.headers.get('origin') !== env.oidcIssuerUrl) {
    throw new ForbiddenError('Invalid origin.');
  }

  const contentType = event.req.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';').at(MEDIA_TYPE_INDEX);

  if (mediaType?.trim().toLowerCase() !== 'application/json') {
    throw new UnsupportedMediaTypeError('Expected a JSON request.');
  }
}

/**
 * Copies the request headers and sets the peer address used by Better Auth.
 * A trusted proxy may supply a valid X-Real-IP. Otherwise the address comes from
 * the connection, with 127.0.0.1 as the fallback.
 *
 * @param {H3Event} event - Incoming request and connection information.
 * @returns {Headers} A mutable copy of the headers for the auth request.
 */
export function authHeaders(event: H3Event): Headers {
  const env = useEnv();
  const headers = new Headers(event.req.headers);
  const proxyIP = env.trustProxyIp ? headers.get('x-real-ip') : null;
  const address = proxyIP && isIP(proxyIP) ? proxyIP : getRequestIP(event);

  headers.set('x-iam-peer-ip', address ?? '127.0.0.1');
  return headers;
}

function authUrl(event: H3Event): URL {
  const env = useEnv();
  const url = new URL(env.oidcIssuerUrl);

  url.pathname = event.url.pathname;
  url.search = event.url.search;
  return url;
}

/**
 * @param {Response} response - Response whose status and body stream will be forwarded.
 * @returns {Response} A response with Cache-Control set to no-store and Referrer-Policy set to no-referrer.
 */
export function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

/**
 * Forwards a GET request to Better Auth at the configured issuer origin.
 *
 * @param {H3Event} event - The incoming request supplies the path, query, and headers.
 * @returns {Promise<Response>} The Better Auth response with caching disabled and a no-referrer policy.
 */
export async function forwardGetRequestToBetterAuth(event: H3Event): Promise<Response> {
  const headers = authHeaders(event);
  const url = authUrl(event);
  const request = new Request(url, { headers });
  const auth = useAuth();
  const response = await auth.handler(request);
  return privateResponse(response);
}

/**
 * Forwards a same-origin JSON POST request to Better Auth at the configured issuer origin.
 *
 * @param {H3Event} event - The incoming request supplies the path, query, headers, and body.
 * @param {'include' | 'omit'} session - `include` forwards the Cookie and Authorization headers.
 *   `omit` removes both before forwarding the request.
 * @returns {Promise<Response>} The Better Auth response with caching disabled and a no-referrer policy.
 * @throws {ForbiddenError} When the Origin header is missing or differs from the issuer origin.
 * @throws {UnsupportedMediaTypeError} When the request media type is not application/json.
 */
export async function forwardPostRequestToBetterAuth(
  event: H3Event,
  session: 'include' | 'omit',
): Promise<Response> {
  checkAuthPost(event);

  const headers = authHeaders(event);

  if (session === 'omit') {
    headers.delete('cookie');
    headers.delete('authorization');
  }

  const url = authUrl(event);
  const body = await event.req.text();
  const request = new Request(url, {
    method: 'POST',
    headers,
    body,
  });
  const auth = useAuth();
  const response = await auth.handler(request);
  return privateResponse(response);
}

/**
 * @param {H3Event} event - Incoming discovery request.
 * @returns {Promise<Response>} OpenID metadata for the mounted protocol endpoints.
 */
export async function getIssuerMetadata(event: H3Event): Promise<Response> {
  const auth = useAuth();
  const request = new Request(authUrl(event), { headers: authHeaders(event) });
  const metadata = await auth.api.getOpenIdConfig({
    request,
    asResponse: false,
  });

  return metadataResponse({
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    jwks_uri: metadata.jwks_uri,
    userinfo_endpoint: metadata.userinfo_endpoint,
    scopes_supported: metadata.scopes_supported,
    subject_types_supported: metadata.subject_types_supported,
    id_token_signing_alg_values_supported: metadata.id_token_signing_alg_values_supported,
    grant_types_supported: metadata.grant_types_supported,
    response_types_supported: metadata.response_types_supported,
    response_modes_supported: metadata.response_modes_supported,
    claims_supported: metadata.claims_supported,
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    code_challenge_methods_supported: metadata.code_challenge_methods_supported,
    authorization_response_iss_parameter_supported:
      metadata.authorization_response_iss_parameter_supported,
  });
}

/**
 * @param {H3Event} event - Form-encoded request from the application backend.
 * @returns {Promise<Response>} Protocol response with caching disabled.
 * @throws {UnsupportedMediaTypeError} When the client sends a different media type.
 */
export async function forwardOAuthFormRequest(event: H3Event): Promise<Response> {
  assertBodySize(event, MAX_AUTH_BODY_BYTES);

  const headers = authHeaders(event);
  const mediaType = headers
    .get('content-type')
    ?.split(';')
    .at(MEDIA_TYPE_INDEX)
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded') {
    throw new UnsupportedMediaTypeError('Expected a form-encoded OAuth request.');
  }

  headers.delete('cookie');

  const url = authUrl(event);
  const body = await event.req.text();
  const request = new Request(url, {
    method: 'POST',
    headers,
    body,
  });
  const auth = useAuth();
  const response = await auth.handler(request);
  return privateResponse(response);
}
