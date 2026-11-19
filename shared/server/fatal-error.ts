import type { IncomingMessage, ServerResponse } from 'node:http';
import { constants } from 'node:http2';

type RequestError = Error & {
  fatal?: boolean;
  unhandled?: boolean;
  statusCode?: number;
};
type RequestEvent = {
  node: { req: IncomingMessage; res: ServerResponse };
};

/**
 * Handles fatal web errors before Nuxt logs the request URL and exception.
 * @param {RequestError} error - Error classified by Nitro.
 * @param {RequestEvent} event - Request whose response Nuxt would otherwise render.
 */
export default function handleFatalError(error: RequestError, event: RequestEvent): void {
  if (!error.unhandled && !error.fatal) {
    return;
  }

  const status = error.statusCode ?? constants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
  const { req, res } = event.node;
  const html = req.headers.accept?.includes('text/html');
  const body = html
    ? `<!doctype html><html lang="en"><title>Request failed</title><h1>Request failed</h1><p>HTTP ${status}</p></html>`
    : JSON.stringify({
        statusCode: status,
        message: 'Request failed',
      });

  console.error('Web request failed', status);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': html ? 'text/html;charset=UTF-8' : 'application/json',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}
