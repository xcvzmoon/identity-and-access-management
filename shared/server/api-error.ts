import type { NitroErrorHandler } from 'nitro/types';
import { H3Event } from 'nitro/h3';
import { constants } from 'node:http2';

const handleApiError: NitroErrorHandler = (error, event): ReturnType<NitroErrorHandler> => {
  if (!error.unhandled) {
    return;
  }

  const status = constants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
  const headers = new Headers(event instanceof H3Event ? event.res.errHeaders : {});
  headers.set('content-type', 'application/json; charset=utf-8');

  return Response.json(
    {
      error: true,
      status,
      unhandled: true,
    },
    {
      status,
      headers,
    },
  );
};

export default handleApiError;
