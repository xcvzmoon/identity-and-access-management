import type { InvitationSignup } from '../schemas/invitation.ts';
import { runWithTransaction } from '@better-auth/core/context';
import { isAPIError } from 'better-auth/api';
import { hasEligibleInvitation } from '../repositories/invitation.repository.ts';
import { useAuth } from '../utils/auth.ts';
import { useEnv } from '../utils/env.ts';
import { BadRequestError, InternalServerError, UnauthorizedError } from '../utils/http-errors.ts';

const unavailableMessage = 'This invitation is unavailable.';

/**
 * Accepts the invitation through Better Auth and commits its status and membership together.
 *
 * @param {string} token - Invitation ID from the emailed link.
 * @param {Headers} headers - Request headers carrying the invitee's session.
 * @returns {Promise<void>} Resolves after the plugin creates the membership.
 * @throws {UnauthorizedError} When the session is missing or the user is unverified.
 * @throws {BadRequestError} When the invitation cannot be accepted by this user.
 */
export async function acceptInvitation(token: string, headers: Headers): Promise<void> {
  const auth = useAuth();
  const context = await auth.$context;

  try {
    await runWithTransaction(context.adapter, async () => {
      await auth.api.acceptInvitation({
        headers,
        body: { invitationId: token },
      });
    });
  } catch (error) {
    if (isAPIError(error)) {
      if (
        error.status === 'UNAUTHORIZED' ||
        error.body?.code === 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION'
      ) {
        throw new UnauthorizedError('Sign in with a verified account.');
      }

      if (error.status === 'BAD_REQUEST' || error.status === 'FORBIDDEN') {
        throw new BadRequestError(unavailableMessage);
      }
    }

    throw new InternalServerError('Invitation acceptance failed.');
  }
}

/**
 * Starts Better Auth signup after checking invitation eligibility. Acceptance happens separately.
 *
 * @param {InvitationSignup} input - Validated signup details and invitation token.
 * @param {Headers} headers - Forwarded request headers. This function removes Content-Length before sending the new body.
 * @returns {Promise<Response>} Better Auth's signup response, including any signup error response.
 * @throws {BadRequestError} When the invitation is unavailable for the supplied email.
 * @throws {Error} When the eligibility query fails.
 */
export async function signUpWithInvitation(
  input: InvitationSignup,
  headers: Headers,
): Promise<Response> {
  const eligible = await hasEligibleInvitation(input.token, input.email);
  if (!eligible) {
    throw new BadRequestError(unavailableMessage);
  }

  const env = useEnv();
  const auth = useAuth();

  headers.delete('content-length');

  const request = new Request(new URL('/api/v1/auth/sign-up/email', env.oidcIssuerUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      password: input.password,
      callbackURL: new URL(`/invite#token=${input.token}&verified=1`, env.oidcIssuerUrl).href,
    }),
  });

  return auth.handler(request);
}
