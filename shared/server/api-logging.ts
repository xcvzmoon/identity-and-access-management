import type { AuditableLogger } from 'evlog';
import type { HTTPEvent } from 'nitro/h3';
import type { NitroApp } from 'nitro/types';
import { createRequestLogger, initLogger, log } from 'evlog';
import { H3Event } from 'nitro/h3';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:http2';

type ApiApp = NitroApp & { hooks: NonNullable<NitroApp['hooks']> };
type ApiService = 'iam-idp-api' | 'iam-console-api';
type RequestFields = {
  event: 'api-request';
  failure?: 'exception';
  managementAction?: string;
  path: string;
  status: number;
};

const requests = new WeakMap<HTTPEvent, AuditableLogger<RequestFields>>();
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/**
 * Emits one JSON event for each API response using matched routes and safe request metadata.
 * @param {ApiApp} app - Nitro application with request lifecycle hooks.
 * @param {ApiService} service - Name written to each event in this process.
 */
export function registerApiLogging(app: ApiApp, service: ApiService): void {
  initLogger({
    env: { service },
    pretty: false,
    stringify: true,
  });

  if (app.h3) {
    app.h3.config.silent = true;
  }

  app.hooks.hook('request', (event) => {
    const method = methods.has(event.req.method) ? event.req.method : 'OTHER';
    const logger = createRequestLogger<RequestFields>({
      method,
      requestId: randomUUID(),
    });

    requests.set(event, logger);
  });

  app.hooks.hook('error', (_error, { event, tags }) => {
    if (event) {
      requests.get(event)?.set({ failure: 'exception' });
      return;
    }

    log.error({
      event: 'api-runtime-error',
      phase: tags?.includes('plugin') ? 'startup' : 'runtime',
    });
  });

  app.hooks.hook('response', (response, event) => {
    const logger = requests.get(event);
    if (!logger) {
      return;
    }

    const { status } = response;
    if (status >= constants.HTTP_STATUS_INTERNAL_SERVER_ERROR) {
      logger.setLevel('error');
    } else if (status >= constants.HTTP_STATUS_BAD_REQUEST) {
      logger.setLevel('warn');
    }

    const route = event instanceof H3Event ? event.context.matchedRoute?.route : null;

    logger.emit({
      event: 'api-request',
      path: route ?? 'unmatched',
      status,
    });
    requests.delete(event);
  });
}

/**
 * Adds the validated command to the current request event.
 * @param {H3Event} event - Request that submitted the command.
 * @param {string} action - Discriminant from the validated management command.
 */
export function recordManagementAction(event: H3Event, action: string): void {
  requests.get(event)?.set({ managementAction: action });
}
