import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { CredentialOverview } from './application-credential-overview.ts';
import type { Auth, AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { hasRecentAdminVerification } from './admin-passkeys.ts';
import { readApplicationCredentialOverview } from './application-credential-overview.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'select' | 'transaction'>;
type AccessPage<Item> = { items: Item[]; nextCursor: string | null };
type App = { id: string; name: string };
type Permission = { key: string };
type Role = { key: string; permissionKeys: string[] };
type OrganizationMember = {
  id: string;
  name: string;
  email: string;
  suspended: boolean;
  role: string;
  promotionEligible: boolean;
};
type Member = { id: string; name: string; email: string; assigned: boolean; roleKeys: string[] };

const { appAssignments, appInstallations, appPermissions, appRoles, applications, members, users } =
  schema;
const firstRow = 0;
const pageSize = 30;
const extraRow = 1;
const maxKeyLength = 100;
const maxSearchLength = 150;
const rateWindowSeconds = 60;
const rateMaximum = 60;
const uuid = valibot.pipe(valibot.string(), valibot.uuid());
const keyCursor = valibot.optional(valibot.pipe(valibot.string(), valibot.maxLength(maxKeyLength)));
const searchSchema = valibot.pipe(
  valibot.string(),
  valibot.trim(),
  valibot.maxLength(maxSearchLength),
);
const requestSchema = valibot.variant('collection', [
  valibot.strictObject({
    collection: valibot.literal('apps'),
    organizationId: uuid,
    cursor: valibot.optional(uuid),
  }),
  valibot.strictObject({
    collection: valibot.picklist(['permissions', 'roles']),
    installationId: uuid,
    cursor: keyCursor,
  }),
  valibot.strictObject({
    collection: valibot.picklist(['organization-members', 'ownership-candidates']),
    organizationId: uuid,
    cursor: valibot.optional(uuid),
    search: valibot.optional(searchSchema),
  }),
  valibot.strictObject({
    collection: valibot.literal('credentials'),
    installationId: uuid,
  }),
  valibot.strictObject({
    collection: valibot.literal('members'),
    installationId: uuid,
    cursor: valibot.optional(uuid),
    search: valibot.optional(searchSchema),
  }),
]);
type AccessRequest = valibot.InferOutput<typeof requestSchema>;

function accessPage<Item>(rows: Item[], cursorOf: (item: Item) => string): AccessPage<Item> {
  const items = rows.slice(firstRow, pageSize);
  const last = items.at(pageSize - extraRow);
  return {
    items,
    nextCursor: rows.length > pageSize && last ? cursorOf(last) : null,
  };
}

async function listApps(
  database: Database,
  organizationId: string,
  cursor: string | undefined,
): Promise<AccessPage<App>> {
  const rows = await database
    .select({
      id: appInstallations.id,
      name: applications.name,
    })
    .from(appInstallations)
    .innerJoin(applications, eq(applications.id, appInstallations.applicationId))
    .where(
      and(
        eq(appInstallations.organizationId, organizationId),
        isNull(applications.deletedAt),
        isNull(appInstallations.deletedAt),
        ...(cursor ? [gt(appInstallations.id, cursor)] : []),
      ),
    )
    .orderBy(asc(appInstallations.id))
    .limit(pageSize + extraRow);

  return accessPage(rows, ({ id }) => id);
}

async function listPermissions(
  database: Database,
  applicationId: string,
  cursor: string | undefined,
): Promise<AccessPage<Permission>> {
  const rows = await database
    .select({ key: appPermissions.key })
    .from(appPermissions)
    .where(
      and(
        eq(appPermissions.applicationId, applicationId),
        ...(cursor ? [gt(appPermissions.key, cursor)] : []),
      ),
    )
    .orderBy(asc(appPermissions.key))
    .limit(pageSize + extraRow);

  return accessPage(rows, ({ key }) => key);
}

async function listRoles(
  database: Database,
  installationId: string,
  cursor: string | undefined,
): Promise<AccessPage<Role>> {
  const rows = await database
    .select({
      key: appRoles.key,
      permissionKeys: sql<string[]>`array(
        select permission_key from iam.app_role_permissions
        where role_id = ${appRoles.id} order by permission_key
      )`,
    })
    .from(appRoles)
    .where(
      and(
        eq(appRoles.installationId, installationId),
        ...(cursor ? [gt(appRoles.key, cursor)] : []),
      ),
    )
    .orderBy(asc(appRoles.key))
    .limit(pageSize + extraRow);

  return accessPage(rows, ({ key }) => key);
}

type MembersRequest = Extract<AccessRequest, { collection: 'members' }>;

async function listMembers(
  database: Database,
  organizationId: string,
  request: MembersRequest,
): Promise<AccessPage<Member>> {
  const { installationId, cursor, search } = request;
  const rows = await database
    .select({
      id: members.id,
      name: users.name,
      email: users.email,
      assigned: sql<boolean>`${appAssignments.id} is not null`,
      roleKeys: sql<string[]>`array(
        select role.key from iam.app_assignment_roles assignment_role
        join iam.app_roles role on role.id = assignment_role.role_id
        where assignment_role.assignment_id = ${appAssignments.id} order by role.key
      )`,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .leftJoin(
      appAssignments,
      and(
        eq(appAssignments.memberId, members.id),
        eq(appAssignments.installationId, installationId),
        isNull(appAssignments.deletedAt),
      ),
    )
    .where(
      and(
        eq(members.organizationId, organizationId),
        isNull(members.suspendedAt),
        isNull(users.deletedAt),
        eq(users.emailVerified, true),
        ...(cursor ? [gt(members.id, cursor)] : []),
        ...(search
          ? [
              or(
                sql`strpos(lower(${users.name}), lower(${search})) > 0`,
                sql`strpos(lower(${users.email}), lower(${search})) > 0`,
              ),
            ]
          : []),
      ),
    )
    .orderBy(asc(members.id))
    .limit(pageSize + extraRow);

  return accessPage(rows, ({ id }) => id);
}

type OrganizationMembersRequest = Extract<
  AccessRequest,
  { collection: 'organization-members' | 'ownership-candidates' }
>;

async function listOrganizationMembers(
  database: Database,
  request: OrganizationMembersRequest,
  mode: 'regular' | 'include-admins',
): Promise<AccessPage<OrganizationMember>> {
  const { collection, organizationId, cursor, search } = request;
  const membershipFilter =
    collection === 'organization-members'
      ? inArray(members.role, mode === 'include-admins' ? ['member', 'admin'] : ['member'])
      : and(
          inArray(members.role, ['member', 'admin']),
          isNull(members.suspendedAt),
          eq(users.emailVerified, true),
        );
  const rows = await database
    .select({
      id: members.id,
      name: users.name,
      email: users.email,
      suspended: sql<boolean>`${members.suspendedAt} is not null`,
      role: members.role,
      promotionEligible:
        mode === 'include-admins'
          ? sql<boolean>`${users.emailVerified} and ${members.suspendedAt} is null`
          : sql<boolean>`false`,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        membershipFilter,
        isNull(users.deletedAt),
        ...(cursor ? [gt(members.id, cursor)] : []),
        ...(search
          ? [
              or(
                sql`strpos(lower(${users.name}), lower(${search})) > 0`,
                sql`strpos(lower(${users.email}), lower(${search})) > 0`,
              ),
            ]
          : []),
      ),
    )
    .orderBy(asc(members.id))
    .limit(pageSize + extraRow);

  return accessPage(rows, ({ id }) => id);
}

async function assertOrganizationAccess(
  database: Database,
  organizationId: string,
  actorId: string,
): Promise<void> {
  if (!(await lockOrganizationAdmin(database, organizationId, actorId))) {
    throw new APIError('FORBIDDEN', { code: 'APP_ACCESS_FORBIDDEN' });
  }
}

async function readAppAccess(
  database: Database,
  actorId: string,
  request: AccessRequest,
): Promise<AccessPage<App | Permission | Role | Member | OrganizationMember> | CredentialOverview> {
  if ('organizationId' in request) {
    if (request.collection === 'apps') {
      await assertOrganizationAccess(database, request.organizationId, actorId);
      return listApps(database, request.organizationId, request.cursor);
    }

    const authority = request.collection === 'ownership-candidates' ? 'owner' : 'owner-or-admin';
    if (!(await lockOrganizationAdmin(database, request.organizationId, actorId, authority))) {
      throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
    }

    const ownsOrganization =
      authority === 'owner' ||
      (await lockOrganizationAdmin(database, request.organizationId, actorId, 'owner'));
    return listOrganizationMembers(
      database,
      request,
      ownsOrganization ? 'include-admins' : 'regular',
    );
  }

  const installations = await database
    .select({
      organizationId: appInstallations.organizationId,
      applicationId: appInstallations.applicationId,
    })
    .from(appInstallations)
    .innerJoin(applications, eq(applications.id, appInstallations.applicationId))
    .where(
      and(
        eq(appInstallations.id, request.installationId),
        isNull(applications.deletedAt),
        isNull(appInstallations.deletedAt),
      ),
    )
    .for('share');
  const installation = installations.at(firstRow);
  if (!installation) {
    throw new APIError('FORBIDDEN', { code: 'APP_ACCESS_FORBIDDEN' });
  }

  await assertOrganizationAccess(database, installation.organizationId, actorId);

  if (request.collection === 'credentials') {
    return readApplicationCredentialOverview(database, {
      installationId: request.installationId,
      organizationId: installation.organizationId,
      actorId,
    });
  }

  if (request.collection === 'members') {
    return listMembers(database, installation.organizationId, request);
  }

  if (request.collection === 'roles') {
    return listRoles(database, request.installationId, request.cursor);
  }

  return listPermissions(database, installation.applicationId, request.cursor);
}

export function adminAccess(
  database: Database,
  options: AuthOptions,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'iam-admin-access',
    rateLimit: [
      {
        pathMatcher: (path) => path === '/admin/access',
        window: rateWindowSeconds,
        max: rateMaximum,
      },
    ],
    endpoints: {
      adminAccess: createAuthEndpoint(
        '/admin/access',
        {
          method: 'POST',
          body: requestSchema,
        },
        async (context) => {
          const headers = context.headers;
          if (
            headers?.get('origin') !== options.webOrigin ||
            headers.has('authorization') ||
            headers.has('x-api-key')
          ) {
            throw new APIError('FORBIDDEN');
          }

          const session = await useAuth().api.getSession({ headers });
          if (!session?.user.emailVerified) {
            throw new APIError('UNAUTHORIZED');
          }

          const result = await database.transaction(async (transaction) => {
            if (!(await hasRecentAdminVerification(transaction, session, 'lock'))) {
              throw new APIError('FORBIDDEN', { code: 'PASSKEY_REQUIRED' });
            }

            return readAppAccess(transaction, session.user.id, context.body);
          });

          return Response.json(result, { headers: { 'cache-control': 'no-store' } });
        },
      ),
    },
  };
}
