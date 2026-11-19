import type { OAuthOptions, Scope } from '@better-auth/oauth-provider';
import { getCurrentAuthEndpointContext } from '@better-auth/core/context';
import { getOAuthProviderState } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { and, eq, exists, gt, isNotNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as valibot from 'valibot';
import { useDatabase } from '../database/index.ts';
import {
  appGrants,
  appInstallations,
  authorizationEvents,
  oauthClients,
  organizations,
  sessions,
  users,
} from '../database/schema.ts';

type Access = {
  name: string;
  organization: string | null;
  organizationId: string | null;
  role: string | null;
  reference: string | null;
  permissions: string[];
};

type AccessBinding = { callback: string } | { sessionId: string };

type AuthorizationEvent = Pick<
  typeof authorizationEvents.$inferSelect,
  'clientId' | 'userId' | 'outcome' | 'stage'
>;

const FIRST_ROW = 0;
export const CONSOLE_CLIENT_ID = 'iam-console';

const clientMetadataSchema = valibot.object({
  rolePermissions: valibot.record(valibot.string(), valibot.array(valibot.string())),
});

export const authorizationQuerySchema = valibot.object({
  client_id: valibot.string(),
  redirect_uri: valibot.string(),
});

const storedAuthorizationCodeSchema = valibot.pipe(
  valibot.string(),
  valibot.parseJson(),
  valibot.looseObject({ type: valibot.literal('authorization_code') }),
);

const authorizationCodeSchema = valibot.object({
  query: authorizationQuerySchema,
  userId: valibot.pipe(valibot.string(), valibot.uuid()),
});

/**
 * Reads the current assignment for an authorization callback or an introspected session.
 *
 * @param {string} clientId - OAuth client identifier.
 * @param {string} userId - Verified IAM user identifier.
 * @param {AccessBinding} binding - Exact authorization callback or session that issued the access token.
 * @returns {Promise<Access | null>} Registration details and the current consent reference, if granted.
 */
export async function readAppAccess(
  clientId: string,
  userId: string,
  binding: AccessBinding,
): Promise<Access | null> {
  const database = useDatabase();
  const now = new Date();
  const sessionFilter =
    'sessionId' in binding
      ? [
          exists(
            database
              .select({ id: sessions.id })
              .from(sessions)
              .where(
                and(
                  eq(sessions.id, binding.sessionId),
                  eq(sessions.userId, userId),
                  gt(sessions.expiresAt, now),
                ),
              ),
          ),
        ]
      : [];
  const rows = await database
    .select({
      name: oauthClients.name,
      metadata: oauthClients.metadata,
      organization: organizations.name,
      organizationId: appInstallations.organizationId,
      role: appGrants.role,
      grantId: appGrants.id,
      revision: appGrants.revision,
      skipConsent: oauthClients.skipConsent,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .innerJoin(users, and(eq(users.id, userId), eq(users.emailVerified, true)))
    .leftJoin(appInstallations, eq(appInstallations.clientId, oauthClients.clientId))
    .leftJoin(organizations, eq(organizations.id, appInstallations.organizationId))
    .leftJoin(
      appGrants,
      and(eq(appGrants.clientId, appInstallations.clientId), eq(appGrants.userId, userId)),
    )
    .where(
      and(
        eq(oauthClients.clientId, clientId),
        ...sessionFilter,
        eq(oauthClients.disabled, false),
        eq(oauthClients.requirePKCE, true),
        eq(oauthClients.applicationType, 'web'),
        eq(oauthClients.tokenEndpointAuthMethod, 'client_secret_basic'),
        isNotNull(oauthClients.clientSecret),
      ),
    );

  const row = rows.at(FIRST_ROW);
  if (!row?.name || ('callback' in binding && !row.redirectUris.includes(binding.callback))) {
    return null;
  }

  const catalog = valibot.safeParse(clientMetadataSchema, row.metadata);
  const permissions =
    row.role && catalog.success && Object.hasOwn(catalog.output.rolePermissions, row.role)
      ? [...new Set(catalog.output.rolePermissions[row.role])].toSorted()
      : [];

  let reference: string | null = null;

  if (clientId === CONSOLE_CLIENT_ID && row.skipConsent === true && !row.organizationId) {
    reference = clientId;
  } else if (row.organizationId && !row.skipConsent && row.revision && row.grantId && row.role) {
    reference = createHash('sha256')
      .update(JSON.stringify([row.grantId, row.revision, row.role, ...permissions]))
      .digest('base64url');
  }

  return {
    name: row.name,
    permissions,
    role: row.role,
    organization: row.organization,
    organizationId: row.organizationId,
    reference,
  };
}

/**
 * Records an authorization decision without storing request parameters or credentials.
 *
 * @param {AuthorizationEvent} event - Client, user, decision, and protocol stage. The registration supplies the organization.
 */
export async function recordAuthorizationEvent(event: AuthorizationEvent): Promise<void> {
  const database = useDatabase();
  const inserted = await database.execute(sql`
    INSERT INTO ${authorizationEvents} (client_id, organization_id, user_id, outcome, stage)
    SELECT ${oauthClients.clientId}, ${appInstallations.organizationId}, ${event.userId},
           ${event.outcome}, ${event.stage}
    FROM ${oauthClients}
    LEFT JOIN ${appInstallations} ON ${appInstallations.clientId} = ${oauthClients.clientId}
    WHERE ${oauthClients.clientId} = ${event.clientId}
  `);

  if (!inserted.count && event.outcome === 'approved') {
    throw new APIError('FORBIDDEN', { error: 'access_denied' });
  }
}

/**
 * Records the provider's authorization decision before it returns a newly issued code.
 * @param {{ value: string }} verification - Stored Better Auth verification record.
 */
export async function recordIssuedAuthorization(verification: { value: string }): Promise<void> {
  const parsed = valibot.safeParse(storedAuthorizationCodeSchema, verification.value);
  if (!parsed.success) {
    return;
  }

  const code = valibot.parse(authorizationCodeSchema, parsed.output);
  await recordAuthorizationEvent({
    clientId: code.query.client_id,
    userId: code.userId,
    outcome: 'approved',
    stage: 'authorization',
  });
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
      const access = await readAppAccess(clientId, user.id, { callback });
      const consent = context.path === '/oauth2/consent';

      if (
        !access?.reference ||
        !user.emailVerified ||
        (consent && context.headers?.get('x-iam-consent-reference') !== access.reference)
      ) {
        await recordAuthorizationEvent({
          clientId,
          userId: user.id,
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
    const access = await readAppAccess(clientId, user.id, { callback });
    const approved =
      user.emailVerified &&
      Boolean(access?.reference) &&
      access?.reference === verificationValue?.referenceId;

    await recordAuthorizationEvent({
      clientId,
      userId: user.id,
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
