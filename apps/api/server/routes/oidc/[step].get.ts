import { HTTPError, defineHandler } from 'nitro';
import { getRouterParam } from 'nitro/h3';
import { getOidcClientName, readOidcRequest } from '../../utils/oidc-interaction.ts';
import { webPage } from '../../utils/web-page.ts';

export default defineHandler(async (event) => {
  const step = getRouterParam(event, 'step');
  if (step !== 'login' && step !== 'consent') {
    throw new HTTPError('Page not found', { status: 404 });
  }

  const request = readOidcRequest(event.url.searchParams.toString());
  if (request.callback.protocol !== 'https:' || request.callback.hostname.includes('*')) {
    throw new HTTPError('Restart sign-in from the application', { status: 400 });
  }

  await getOidcClientName(event, request);
  event.res.headers.set(
    'Content-Security-Policy',
    `frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${request.callback.origin}`,
  );

  return webPage();
});
