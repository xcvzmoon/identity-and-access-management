import { HTTPError, defineHandler } from 'nitro';
import { webPage } from '../utils/web-page.ts';

const pages = new Set(['/', '/signin', '/signup', '/account', '/admin', '/recover-password']);

export default defineHandler(async (event) => {
  if (!pages.has(event.url.pathname)) {
    throw new HTTPError('Page not found', { status: 404 });
  }

  return webPage();
});
