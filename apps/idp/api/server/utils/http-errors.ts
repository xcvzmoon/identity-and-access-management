import { HTTPError } from 'nitro';
import { STATUS_CODES } from 'node:http';
import { constants } from 'node:http2';

type HttpErrorConstructor = new (message?: string) => HTTPError;

function defineHttpError(status: number): HttpErrorConstructor {
  return class extends HTTPError {
    public constructor(message?: string) {
      super({
        status,
        statusText: STATUS_CODES[status],
        message,
      });
    }
  };
}

export const BadRequestError = defineHttpError(constants.HTTP_STATUS_BAD_REQUEST);
export const UnauthorizedError = defineHttpError(constants.HTTP_STATUS_UNAUTHORIZED);
export const ForbiddenError = defineHttpError(constants.HTTP_STATUS_FORBIDDEN);
export const NotFoundError = defineHttpError(constants.HTTP_STATUS_NOT_FOUND);
export const UnsupportedMediaTypeError = defineHttpError(
  constants.HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
);
export const InternalServerError = defineHttpError(constants.HTTP_STATUS_INTERNAL_SERVER_ERROR);
export const NotImplementedError = defineHttpError(constants.HTTP_STATUS_NOT_IMPLEMENTED);
