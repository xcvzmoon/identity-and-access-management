import type { OAuthOptions } from '@better-auth/oauth-provider';
import type { AccessLookup } from './oidc-token-responses.ts';
import { getCurrentAuthEndpointContext } from '@better-auth/core/context';
import { getOAuthProviderState, oauthProvider } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import * as valibot from 'valibot';
import { requireCurrentUserInfoGrant } from './oidc-token-responses.ts';

type ResolveApplicationGrant = (
  clientId: string,
  userId: string,
  redirectUri: string,
) => string | null | Promise<string | null>;
type ApplicationOidcPolicy = {
  resolveAccess: ResolveApplicationGrant;
  readTokenAccess: AccessLookup;
};

export type ManagedRegistration = Pick<OAuthOptions, 'clientPrivileges' | 'clientReference'>;

const accessTokenLifetimeSeconds = 300;
const authorizationQuerySchema = valibot.object({
  client_id: valibot.pipe(valibot.string(), valibot.nonEmpty()),
  redirect_uri: valibot.pipe(valibot.string(), valibot.nonEmpty()),
});
type AuthorizationQuery = valibot.InferOutput<typeof authorizationQuerySchema>;

async function resolveAuthorizationQuery(): Promise<AuthorizationQuery | null> {
  const context = getCurrentAuthEndpointContext();
  if (context.path !== '/oauth2/consent') {
    const query = valibot.safeParse(authorizationQuerySchema, context.query);
    return query.success ? query.output : null;
  }

  const request = await getOAuthProviderState();
  if (!request) {
    return null;
  }

  const signed = new URLSearchParams(request.query);
  const query = valibot.safeParse(authorizationQuerySchema, {
    client_id: signed.get('client_id'),
    redirect_uri: signed.get('redirect_uri'),
  });

  return query.success ? query.output : null;
}

export function createApplicationOidcProvider(
  loginPage: string,
  consentPage: string,
  policy: ApplicationOidcPolicy,
  registration?: ManagedRegistration,
): ReturnType<typeof oauthProvider> {
  const { resolveAccess, readTokenAccess } = policy;
  return oauthProvider({
    ...registration,
    clientPrivileges: registration?.clientPrivileges ?? (() => false),
    loginPage,
    accessTokenExpiresIn: accessTokenLifetimeSeconds,
    consentPage,
    scopes: ['openid'],
    grantTypes: ['authorization_code'],
    allowDynamicClientRegistration: false,
    allowPublicClientPrelogin: true,
    customUserInfoClaims: async ({ jwt }) => requireCurrentUserInfoGrant(readTokenAccess, jwt),
    extensions: [
      {
        claims: {
          accessToken: ({ referenceId }) => (referenceId ? { iam_grant_version: referenceId } : {}),
        },
      },
    ],
    postLogin: {
      page: loginPage,
      shouldRedirect: () => false,
      consentReferenceId: async ({ user }) => {
        const query = await resolveAuthorizationQuery();
        const grantVersion = query
          ? await resolveAccess(query.client_id, user.id, query.redirect_uri)
          : null;

        if (!grantVersion) {
          throw new APIError('FORBIDDEN', {
            error: 'access_denied',
          });
        }

        return grantVersion;
      },
    },
    customTokenResponseFields: async ({ user, verificationValue }) => {
      const clientId = verificationValue?.query.client_id;
      const redirectUri = verificationValue?.query.redirect_uri;
      if (
        !user ||
        !clientId ||
        !redirectUri ||
        !verificationValue.referenceId ||
        (await resolveAccess(clientId, user.id, redirectUri)) !== verificationValue.referenceId
      ) {
        throw new APIError('BAD_REQUEST', {
          error: 'invalid_grant',
        });
      }

      return {};
    },
  });
}
