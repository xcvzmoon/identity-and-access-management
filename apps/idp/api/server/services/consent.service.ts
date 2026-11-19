import type { H3Event } from 'nitro/h3';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import * as valibot from 'valibot';
import { useAuth } from '../utils/auth.ts';
import { useEnv } from '../utils/env.ts';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../utils/http-errors.ts';
import {
  authHeaders,
  checkAuthPost,
  forwardPostRequestToBetterAuth,
  privateResponse,
} from './auth.service.ts';
import {
  authorizationQuerySchema,
  readAppAccess,
  recordAuthorizationEvent,
} from './authorization.service.ts';

type ConsentRequest = { clientId: string; callback: string; userId: string; decline: boolean };

const consentSchema = valibot.object({
  oauth_query: valibot.string(),
  accept: valibot.optional(valibot.boolean()),
});

async function readConsentRequest(event: H3Event): Promise<ConsentRequest> {
  checkAuthPost(event);

  const env = useEnv();
  const auth = useAuth();
  const headers = authHeaders(event);
  const body: unknown = await event.req
    .clone()
    .json()
    .catch(() => null);
  const parsed = valibot.safeParse(consentSchema, body);

  if (
    !parsed.success ||
    !(await verifyOAuthQueryParams(parsed.output.oauth_query, env.betterAuthSecret))
  ) {
    throw new BadRequestError('Invalid or expired consent request.');
  }

  const query = new URLSearchParams(parsed.output.oauth_query);
  const request = valibot.safeParse(authorizationQuerySchema, Object.fromEntries(query));
  const session = await auth.api.getSession({ headers });

  if (!session?.user.emailVerified || query.get('ba_pl') !== session.session.id) {
    throw new UnauthorizedError('Sign in again to review this request.');
  }

  if (!request.success) {
    throw new BadRequestError('Invalid consent request.');
  }

  return {
    clientId: request.output.client_id,
    callback: request.output.redirect_uri,
    userId: session.user.id,
    decline: parsed.output.accept === false,
  };
}

/**
 * Returns the app and current grant that this signed-in user is being asked to approve.
 *
 * @param {H3Event} event - Same-origin request carrying the signed OAuth query.
 * @returns {Promise<Response>} App name, organization, role, and consent reference.
 */
export async function consentDetails(event: H3Event): Promise<Response> {
  const { clientId, callback, userId } = await readConsentRequest(event);
  const access = await readAppAccess(clientId, userId, callback);

  if (!access?.reference) {
    throw new ForbiddenError('App access is unavailable.');
  }

  return privateResponse(
    Response.json({
      name: access.name,
      organization: access.organization,
      role: access.role,
      reference: access.reference,
    }),
  );
}

/**
 * Binds the signed consent interaction to its original session and records explicit declines.
 *
 * @param {H3Event} event - Same-origin request carrying the consent decision.
 * @returns {Promise<Response>} The provider's response to the decision.
 */
export async function forwardConsent(event: H3Event): Promise<Response> {
  const { clientId, callback, userId, decline } = await readConsentRequest(event);
  const response = await forwardPostRequestToBetterAuth(event, 'include');

  if (decline && response.ok) {
    const access = await readAppAccess(clientId, userId, callback);

    await recordAuthorizationEvent({
      clientId,
      userId,
      organizationId: access?.organizationId,
      stage: 'consent',
      outcome: 'denied',
    });
  }

  return response;
}
