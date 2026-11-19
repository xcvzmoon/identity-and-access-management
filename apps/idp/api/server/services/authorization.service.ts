import type { OAuthOptions, Scope } from '@better-auth/oauth-provider';
import { getCurrentAuthEndpointContext } from '@better-auth/core/context';
import { getOAuthProviderState } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { and, eq, isNotNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as valibot from 'valibot';
import { useDatabase } from '../database/index.ts';
import {
  appGrants,
  appInstallations,
  authorizationEvents,
  oauthClients,
  organizations,
} from '../database/schema.ts';

type Access = {
  name: string;
  organization: string | null;
  organizationId: string | null;
  role: string | null;
  reference: string | null;
};

type AuthorizationEvent = typeof authorizationEvents.$inferInsert;

const FIRST_ROW = 0;
export const CONSOLE_CLIENT_ID = 'iam-console';

export const authorizationQuerySchema = valibot.object({
  client_id: valibot.string(),
  redirect_uri: valibot.string(),
});

/**
 * Reads the current assignment for a registered callback and user.
 *
 * @param {string} clientId - OAuth client identifier.
 * @param {string} userId - Verified IAM user identifier.
 * @param {string} callback - Exact redirect URI from the authorization request.
 * @returns {Promise<Access | null>} Registration details and the current consent reference, if granted.
 */
export async function readAppAccess(
  clientId: string,
  userId: string,
  callback: string,
): Promise<Access | null> {
  const database = useDatabase();
  const rows = await database
    .select({
      name: oauthClients.name,
      organization: organizations.name,
      organizationId: appInstallations.organizationId,
      role: appGrants.role,
      grantId: appGrants.id,
      revision: appGrants.revision,
      skipConsent: oauthClients.skipConsent,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .leftJoin(appInstallations, eq(appInstallations.clientId, oauthClients.clientId))
    .leftJoin(organizations, eq(organizations.id, appInstallations.organizationId))
    .leftJoin(
      appGrants,
      and(eq(appGrants.clientId, appInstallations.clientId), eq(appGrants.userId, userId)),
    )
    .where(
      and(
        eq(oauthClients.clientId, clientId),
        eq(oauthClients.disabled, false),
        eq(oauthClients.requirePKCE, true),
        eq(oauthClients.applicationType, 'web'),
        eq(oauthClients.tokenEndpointAuthMethod, 'client_secret_basic'),
        isNotNull(oauthClients.clientSecret),
      ),
    );

  const row = rows.at(FIRST_ROW);
  if (!row?.name || !row.redirectUris.includes(callback)) {
    return null;
  }

  let reference: string | null = null;

  if (clientId === CONSOLE_CLIENT_ID && row.skipConsent === true && !row.organizationId) {
    reference = clientId;
  } else if (row.organizationId && !row.skipConsent && row.revision && row.grantId && row.role) {
    reference = createHash('sha256')
      .update(JSON.stringify([row.grantId, row.revision, row.role]))
      .digest('base64url');
  }

  return {
    name: row.name,
    role: row.role,
    organization: row.organization,
    organizationId: row.organizationId,
    reference,
  };
}

/**
 * Records an authorization decision without storing request parameters or credentials.
 *
 * @param {AuthorizationEvent} event - Client, tenant, user, decision, and protocol stage.
 */
export async function recordAuthorizationEvent(event: AuthorizationEvent): Promise<void> {
  const database = useDatabase();
  await database.insert(authorizationEvents).values(event);
}

export const authorizationPolicy: Pick<
  OAuthOptions<Scope[]>,
  'postLogin' | 'customTokenResponseFields' | 'extensions'
> = {
  postLogin: {
    page: '/sign-in',
    shouldRedirect: () => false,
    consentReferenceId: async ({ user }) => {
      const context = getCurrentAuthEndpointContext();
      const state = await getOAuthProviderState();
      const query: unknown = state?.query
        ? Object.fromEntries(new URLSearchParams(state.query))
        : context.query;
      const { client_id: clientId, redirect_uri: callback } = valibot.parse(
        authorizationQuerySchema,
        query,
      );
      const access = await readAppAccess(clientId, user.id, callback);
      const consent = context.path === '/oauth2/consent';

      if (
        !access?.reference ||
        !user.emailVerified ||
        (consent && context.headers?.get('x-iam-consent-reference') !== access.reference)
      ) {
        await recordAuthorizationEvent({
          clientId,
          userId: user.id,
          organizationId: access?.organizationId,
          outcome: 'denied',
          stage: consent ? 'consent' : 'authorization',
        });
        throw new APIError('FORBIDDEN', { error: 'access_denied' });
      }

      return access.reference;
    },
  },
  customTokenResponseFields: async ({ user, verificationValue }) => {
    const query = valibot.safeParse(authorizationQuerySchema, verificationValue?.query);

    if (!user || !query.success) {
      throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
    }

    const { client_id: clientId, redirect_uri: callback } = query.output;
    const access = await readAppAccess(clientId, user.id, callback);
    const approved =
      user.emailVerified &&
      Boolean(access?.reference) &&
      access?.reference === verificationValue?.referenceId;

    await recordAuthorizationEvent({
      clientId,
      userId: user.id,
      organizationId: access?.organizationId,
      stage: 'exchange',
      outcome: approved ? 'approved' : 'denied',
    });

    if (!approved) {
      throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
    }

    return {};
  },
  extensions: [
    {
      claims: {
        accessToken: ({ referenceId }) => ({ iam_grant_version: referenceId }),
      },
    },
  ],
};
