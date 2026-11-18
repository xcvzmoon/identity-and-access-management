import type { OAuthOptions } from '@better-auth/oauth-provider';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import * as valibot from 'valibot';

type ApplicationTokenAccess = { grantVersion: string; permissions: string[] };
export type AccessLookup = (
  clientId: string,
  userId: string,
  sessionId: string,
) => ApplicationTokenAccess | null | Promise<ApplicationTokenAccess | null>;
type AccessTokenPayload = Parameters<
  NonNullable<OAuthOptions['customUserInfoClaims']>
>[number]['jwt'];

const tokenGrantFields = {
  client_id: valibot.pipe(valibot.string(), valibot.nonEmpty()),
  sub: valibot.pipe(valibot.string(), valibot.uuid()),
  sid: valibot.pipe(valibot.string(), valibot.uuid()),
  iam_grant_version: valibot.pipe(valibot.string(), valibot.nonEmpty()),
};
const tokenGrantSchema = valibot.object(tokenGrantFields);
const introspectionSchema = valibot.object({
  active: valibot.literal(true),
  ...tokenGrantFields,
  iss: valibot.string(),
  exp: valibot.number(),
  scope: valibot.literal('openid'),
  token_type: valibot.literal('Bearer'),
});
const userInfoSchema = valibot.pick(tokenGrantSchema, ['sub']);

function invalidUserInfoToken(): APIError {
  return new APIError(
    'UNAUTHORIZED',
    { error: 'invalid_token' },
    { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
  );
}

/**
 * Checks that a verified access token still matches its session and app grant.
 * @param {AccessLookup} readAccess - Looks up current access for the token's client, user, and session.
 * @param {AccessTokenPayload} jwt - Claims from Better Auth's verified access token.
 * @returns {Promise<Record<string, never>>} An empty object because UserInfo adds no custom claims.
 * @throws {APIError} If the grant is missing or stale.
 */
export async function requireCurrentUserInfoGrant(
  readAccess: AccessLookup,
  jwt: AccessTokenPayload,
): Promise<Record<string, never>> {
  const token = valibot.safeParse(tokenGrantSchema, jwt);
  if (!token.success) {
    throw invalidUserInfoToken();
  }

  const { client_id, sub, sid, iam_grant_version } = token.output;
  const access = await readAccess(client_id, sub, sid);
  if (access?.grantVersion !== iam_grant_version) {
    throw invalidUserInfoToken();
  }

  return {};
}

/**
 * Limits UserInfo to the subject and checks live access during token introspection.
 * @param {AccessLookup} readAccess - Looks up current access for the token's client, user, and session.
 * @returns {BetterAuthPlugin} The hooks for UserInfo and token introspection responses.
 */
export function applicationTokenResponses(readAccess: AccessLookup): BetterAuthPlugin {
  return {
    id: 'application-token-introspection',
    hooks: {
      after: [
        {
          matcher: (context) =>
            context.path === '/oauth2/userinfo' && !isAPIError(context.context.returned),
          handler: createAuthMiddleware(async (context) => {
            const result = valibot.safeParse(userInfoSchema, context.context.returned);
            if (!result.success) {
              throw invalidUserInfoToken();
            }

            return context.json(result.output);
          }),
        },
        {
          matcher: (context) =>
            context.path === '/oauth2/introspect' && !isAPIError(context.context.returned),
          handler: createAuthMiddleware(async (context) => {
            const token = valibot.safeParse(introspectionSchema, context.context.returned);
            if (!token.success) {
              return context.json({ active: false });
            }

            const { client_id, sub, sid, iss, exp, scope, token_type, iam_grant_version } =
              token.output;
            const access = await readAccess(client_id, sub, sid);
            if (access?.grantVersion !== iam_grant_version) {
              return context.json({ active: false });
            }

            return context.json({
              active: true,
              client_id,
              sub,
              iss,
              exp,
              scope,
              token_type,
              permissions: access.permissions,
            });
          }),
        },
      ],
    },
  };
}
