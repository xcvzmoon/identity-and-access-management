import { HTTPError, defineHandler } from 'nitro';
import { setOidcHeaders } from '../../utils/auth-http.ts';
import { getOidcClientName, readOidcRequest } from '../../utils/oidc-interaction.ts';

export default defineHandler(async (event) => {
  setOidcHeaders(event);

  const request = readOidcRequest(event.url.searchParams.get('request'));
  if (request.callback.protocol !== 'https:' || request.callback.hostname.includes('*')) {
    throw new HTTPError('Restart sign-in from the application', { status: 400 });
  }

  return {
    name: await getOidcClientName(event, request),
    callbackOrigin: request.callback.origin,
  };
});
