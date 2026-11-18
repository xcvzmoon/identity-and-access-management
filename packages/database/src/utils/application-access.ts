import type { Database } from './client.ts';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  appAssignmentRoles,
  appAssignments,
  appClients,
  appInstallations,
  appRolePermissions,
  applications,
  members,
  oauthClients,
  organizations,
  sessions,
  users,
} from '../schema/index.ts';

type AccessDatabase = Pick<Database, 'select' | 'selectDistinct'>;
type AccessQuery = {
  clientId: string;
  userId: string;
  sessionId: string | null;
  redirectUri?: string;
};
type ApplicationAccess = {
  installationId: string;
  grantVersion: string;
  permissions: string[];
};

const firstRow = 0;

async function readActiveAccess(
  database: AccessDatabase,
  query: AccessQuery,
  include: 'grant' | 'permissions',
): Promise<ApplicationAccess | null> {
  const permissionKeys = database
    .selectDistinct({ permissionKey: appRolePermissions.permissionKey })
    .from(appAssignmentRoles)
    .innerJoin(appRolePermissions, eq(appRolePermissions.roleId, appAssignmentRoles.roleId))
    .where(eq(appAssignmentRoles.assignmentId, appAssignments.id));
  const permissions =
    include === 'permissions'
      ? sql<string[]>`array(${permissionKeys})`
      : sql<string[]>`array[]::text[]`;
  const redirectUri = query.redirectUri ?? null;
  const sessionFilter =
    query.sessionId === null
      ? sql`true`
      : sql`exists (
          select 1 from ${sessions}
          where ${eq(sessions.id, query.sessionId)}
            and ${eq(sessions.userId, users.id)}
            and ${gt(sessions.expiresAt, sql`now()`)}
            and ${isNull(sessions.deletedAt)}
        )`;
  const assignments = await database
    .select({
      installationId: appInstallations.id,
      grantVersion: sql<string>`${appAssignments.grantVersion}::text || ':' || ${appClients.credentialVersion}::text`,
      permissions,
    })
    .from(appClients)
    .innerJoin(oauthClients, eq(oauthClients.clientId, appClients.clientId))
    .innerJoin(appInstallations, eq(appInstallations.id, appClients.installationId))
    .innerJoin(applications, eq(applications.id, appInstallations.applicationId))
    .innerJoin(organizations, eq(organizations.id, appInstallations.organizationId))
    .innerJoin(appAssignments, eq(appAssignments.installationId, appInstallations.id))
    .innerJoin(members, eq(members.id, appAssignments.memberId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(appClients.clientId, query.clientId),
        eq(users.id, query.userId),
        eq(users.emailVerified, true),
        isNull(users.deletedAt),
        isNull(organizations.disabledAt),
        isNull(members.suspendedAt),
        isNull(applications.deletedAt),
        isNull(appInstallations.deletedAt),
        isNull(appClients.deletedAt),
        eq(oauthClients.disabled, false),
        isNull(appAssignments.deletedAt),
        redirectUri === null
          ? sql`true`
          : sql`(${redirectUri}::text collate "C") = any(${oauthClients.redirectUris})`,
        sessionFilter,
      ),
    );

  return assignments.at(firstRow) ?? null;
}

/**
 * Looks up the current installation grant for the authenticated user and OAuth client.
 * @param {AccessDatabase} database - Shared IAM database.
 * @param {string} clientId - Client identifier validated by the OAuth provider.
 * @param {string} userId - Authenticated user's ID.
 * @param {string | null} [permissionKey] - Application permission that must be granted, when supplied.
 * @returns {Promise<string | null>} Installation ID when access is active, otherwise null.
 */
export async function resolveApplicationAccess(
  database: AccessDatabase,
  clientId: string,
  userId: string,
  permissionKey: string | null = null,
): Promise<string | null> {
  const query = {
    clientId,
    userId,
    sessionId: null,
  };
  const access = await readActiveAccess(
    database,
    query,
    permissionKey === null ? 'grant' : 'permissions',
  );

  if (permissionKey !== null && !access?.permissions.includes(permissionKey)) {
    return null;
  }

  return access?.installationId ?? null;
}

/**
 * Returns the current application grant version for a provider-validated client and user.
 * @param {AccessDatabase} database - Shared IAM database.
 * @param {string} clientId - OAuth client ID.
 * @param {string} userId - Authenticated user's ID.
 * @param {string} [redirectUri] - Exact registered callback required for OIDC issuance.
 * @returns {Promise<string | null>} Grant version or null when access is inactive.
 */
export async function resolveApplicationGrant(
  database: AccessDatabase,
  clientId: string,
  userId: string,
  redirectUri?: string,
): Promise<string | null> {
  const query = {
    clientId,
    userId,
    sessionId: null,
    redirectUri,
  };
  const access = await readActiveAccess(database, query, 'grant');
  return access?.grantVersion ?? null;
}

/**
 * Reads live product permissions for a token with a provider-validated client, user, and session.
 * @param {AccessDatabase} database - Shared IAM database.
 * @param {string} clientId - Validated OAuth client ID.
 * @param {string} userId - Subject from the validated token.
 * @param {string} sessionId - IAM session ID from the validated token.
 * @returns {Promise<ApplicationAccess | null>} Current grant and permission keys, or null when inactive.
 */
export async function readApplicationTokenAccess(
  database: AccessDatabase,
  clientId: string,
  userId: string,
  sessionId: string,
): Promise<ApplicationAccess | null> {
  return readActiveAccess(database, { clientId, userId, sessionId }, 'permissions');
}
