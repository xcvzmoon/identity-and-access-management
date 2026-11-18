import { HTTPError, defineHandler } from 'nitro';
import { assertBodySize, getRouterParam } from 'nitro/h3';
import * as valibot from 'valibot';
import {
  maxAuthBodyBytes,
  postAuth,
  requireBrowserOrigin,
  requireForm,
  setOidcHeaders,
} from '../../utils/auth-http.ts';
import { readOidcRequest, redirectOidcInteraction } from '../../utils/oidc-interaction.ts';

const maxPasswordLength = 128;
const credentialsSchema = valibot.object({
  email: valibot.pipe(valibot.string(), valibot.trim(), valibot.email()),
  password: valibot.pipe(
    valibot.string(),
    valibot.nonEmpty(),
    valibot.maxLength(maxPasswordLength),
  ),
});

export default defineHandler(async (event) => {
  setOidcHeaders(event);

  const step = getRouterParam(event, 'step');
  if (step !== 'login' && step !== 'consent') {
    throw new HTTPError('Page not found', { status: 404 });
  }

  const origin = await requireBrowserOrigin(event);

  requireForm(event);
  assertBodySize(event, maxAuthBodyBytes);

  const data = new URLSearchParams(await event.req.text());
  const request = readOidcRequest(data.get('oauth_query'));
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    origin,
  });

  if (step === 'login') {
    const credentials = valibot.safeParse(credentialsSchema, {
      email: data.get('email'),
      password: data.get('password'),
    });

    if (!credentials.success) {
      throw new HTTPError('Enter your email and password', { status: 400 });
    }

    const upstream = await postAuth(event, '/api/auth/sign-in/email', headers, {
      ...credentials.output,
      oauth_query: request.query,
    });
    return redirectOidcInteraction(upstream, request);
  }

  const intent = data.get('intent');
  if (intent !== 'allow' && intent !== 'deny') {
    throw new HTTPError('Choose whether to continue', { status: 400 });
  }

  const cookie = event.req.headers.get('cookie');
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  const upstream = await postAuth(event, '/api/auth/oauth2/consent', headers, {
    accept: intent === 'allow',
    oauth_query: request.query,
  });

  return redirectOidcInteraction(upstream, request);
});
