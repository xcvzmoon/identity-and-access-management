import type { Database } from './client.ts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import {
  appAccessEvents,
  appAssignmentRoles,
  appAssignments,
  appInstallations,
  appPermissions,
  appRolePermissions,
  appRoles,
  applications,
  members,
  organizations,
  users,
} from '../schema/index.ts';

type AccessManager = {
  actorId: string;
  installationId: string;
};
type Transaction = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
type TransactionRunner = Pick<Database, 'transaction'>;
type ManagedInstallation = {
  id: string;
  applicationId: string;
  organizationId: string;
};
type ManagementAction =
  | 'permissions.registered'
  | 'role.saved'
  | 'assignment.granted'
  | 'assignment.revoked';
type ApplicationAccessErrorCode =
  | 'APP_ACCESS_FORBIDDEN'
  | 'APP_MEMBER_UNAVAILABLE'
  | 'APP_PERMISSION_NOT_FOUND'
  | 'APP_ROLE_NOT_FOUND';

/** A rejected application access change with a code safe for administrative callers. */
export class ApplicationAccessError extends Error {
  public readonly code: ApplicationAccessErrorCode;

  public constructor(code: ApplicationAccessErrorCode) {
    super(code);
    this.name = 'ApplicationAccessError';
    this.code = code;
  }
}

const firstRow = 0;
const emptyLength = 0;
const maximumKeyLength = 100;
const maximumKeys = 100;
const keySchema = valibot.pipe(
  valibot.string(),
  valibot.maxLength(maximumKeyLength),
  valibot.regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u),
);
/** Bounded list of keys from one application's permission catalog. */
export const applicationPermissionKeysSchema = valibot.pipe(
  valibot.array(keySchema),
  valibot.maxLength(maximumKeys),
);
/** A role key and the complete set of permissions for that role. */
export const applicationRoleInputSchema = valibot.strictObject({
  key: keySchema,
  permissionKeys: applicationPermissionKeysSchema,
});
/** A member's app access grant, role replacement, or revocation. */
export const applicationAssignmentInputSchema = valibot.variant('action', [
  valibot.strictObject({
    action: valibot.literal('grant'),
    memberId: valibot.pipe(valibot.string(), valibot.uuid()),
    roleKeys: applicationPermissionKeysSchema,
  }),
  valibot.strictObject({
    action: valibot.literal('revoke'),
    memberId: valibot.pipe(valibot.string(), valibot.uuid()),
  }),
]);
type RoleInput = valibot.InferInput<typeof applicationRoleInputSchema>;
type AssignmentInput = valibot.InferInput<typeof applicationAssignmentInputSchema>;

async function lockManagedInstallation(
  transaction: Transaction,
  manager: AccessManager,
): Promise<ManagedInstallation> {
  const installations = await transaction
    .select({
      id: appInstallations.id,
      applicationId: appInstallations.applicationId,
      organizationId: appInstallations.organizationId,
      role: members.role,
    })
    .from(appInstallations)
    .innerJoin(applications, eq(applications.id, appInstallations.applicationId))
    .innerJoin(organizations, eq(organizations.id, appInstallations.organizationId))
    .innerJoin(members, eq(members.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(appInstallations.id, manager.installationId),
        eq(users.id, manager.actorId),
        eq(users.emailVerified, true),
        isNull(users.deletedAt),
        isNull(members.suspendedAt),
        isNull(organizations.disabledAt),
        isNull(applications.deletedAt),
        isNull(appInstallations.deletedAt),
      ),
    )
    .for('update');
  const installation = installations.at(firstRow);
  if (!installation?.role.split(',').some((role) => role === 'owner' || role === 'admin')) {
    throw new ApplicationAccessError('APP_ACCESS_FORBIDDEN');
  }

  return installation;
}

async function recordAccessChange(
  transaction: Transaction,
  manager: AccessManager,
  action: ManagementAction,
  details: Record<string, string | string[]>,
): Promise<void> {
  await transaction.insert(appAccessEvents).values({
    ...manager,
    action,
    details,
  });
}

/**
 * Adds permission keys to the owning application's catalog.
 * @param {TransactionRunner} database - Shared IAM database or existing transaction.
 * @param {AccessManager} manager - Authenticated actor and target installation.
 * @param {string[]} keys - Permission keys defined by the application.
 * @returns {Promise<void>} Resolves after saving the catalog and audit event.
 * @throws {Error} Invalid input, unauthorized actor, or database failure.
 */
export async function registerApplicationPermissions(
  database: TransactionRunner,
  manager: AccessManager,
  keys: string[],
): Promise<void> {
  const permissionKeys = [...new Set(valibot.parse(applicationPermissionKeysSchema, keys))];
  await database.transaction(async (transaction) => {
    const installation = await lockManagedInstallation(transaction, manager);

    if (permissionKeys.length === emptyLength) {
      return;
    }

    await transaction
      .insert(appPermissions)
      .values(
        permissionKeys.map((key) => ({
          applicationId: installation.applicationId,
          key,
        })),
      )
      .onConflictDoNothing();
    await recordAccessChange(transaction, manager, 'permissions.registered', { permissionKeys });
  });
}

/**
 * Creates a role or replaces its permissions in one installation.
 * @param {TransactionRunner} database - Shared IAM database or existing transaction.
 * @param {AccessManager} manager - Authenticated actor and target installation.
 * @param {RoleInput} input - Role key and complete set of catalog permission keys.
 * @returns {Promise<void>} Resolves after saving the role and audit event.
 * @throws {Error} Invalid input, an unknown permission, unauthorized actor, or database failure.
 */
export async function saveApplicationRole(
  database: TransactionRunner,
  manager: AccessManager,
  input: RoleInput,
): Promise<void> {
  const role = valibot.parse(applicationRoleInputSchema, input);
  const permissionKeys = [...new Set(role.permissionKeys)];
  await database.transaction(async (transaction) => {
    const installation = await lockManagedInstallation(transaction, manager);
    const { applicationId } = installation;

    if (permissionKeys.length > emptyLength) {
      const permissions = await transaction
        .select({ key: appPermissions.key })
        .from(appPermissions)
        .where(
          and(
            eq(appPermissions.applicationId, applicationId),
            inArray(appPermissions.key, permissionKeys),
          ),
        );

      if (permissions.length !== permissionKeys.length) {
        throw new ApplicationAccessError('APP_PERMISSION_NOT_FOUND');
      }
    }

    const [{ id: roleId }] = await transaction
      .insert(appRoles)
      .values({
        installationId: installation.id,
        applicationId,
        key: role.key,
      })
      .onConflictDoUpdate({
        target: [appRoles.installationId, appRoles.key],
        set: { key: role.key },
      })
      .returning({ id: appRoles.id });
    await transaction.delete(appRolePermissions).where(eq(appRolePermissions.roleId, roleId));

    if (permissionKeys.length > emptyLength) {
      await transaction
        .insert(appRolePermissions)
        .values(permissionKeys.map((permissionKey) => ({ applicationId, roleId, permissionKey })));
    }

    await recordAccessChange(transaction, manager, 'role.saved', {
      roleKey: role.key,
      permissionKeys,
    });
  });
}

async function revokeAssignment(
  transaction: Transaction,
  manager: AccessManager,
  memberId: string,
): Promise<void> {
  const assignments = await transaction
    .update(appAssignments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(appAssignments.installationId, manager.installationId),
        eq(appAssignments.memberId, memberId),
        isNull(appAssignments.deletedAt),
      ),
    )
    .returning({ id: appAssignments.id });
  const assignment = assignments.at(firstRow);
  if (assignment) {
    await transaction
      .delete(appAssignmentRoles)
      .where(eq(appAssignmentRoles.assignmentId, assignment.id));
    await recordAccessChange(transaction, manager, 'assignment.revoked', { memberId });
  }
}

async function grantAssignment(
  transaction: Transaction,
  installation: ManagedInstallation,
  memberId: string,
  roleKeys: string[],
): Promise<void> {
  const activeMembers = await transaction
    .select({ id: members.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.id, memberId),
        eq(members.organizationId, installation.organizationId),
        eq(users.emailVerified, true),
        isNull(members.suspendedAt),
        isNull(users.deletedAt),
      ),
    )
    .for('update');

  if (activeMembers.length === emptyLength) {
    throw new ApplicationAccessError('APP_MEMBER_UNAVAILABLE');
  }

  const roleIds =
    roleKeys.length > emptyLength
      ? await transaction
          .select({ id: appRoles.id })
          .from(appRoles)
          .where(and(eq(appRoles.installationId, installation.id), inArray(appRoles.key, roleKeys)))
      : [];

  if (roleIds.length !== roleKeys.length) {
    throw new ApplicationAccessError('APP_ROLE_NOT_FOUND');
  }

  const [{ id: assignmentId }] = await transaction
    .insert(appAssignments)
    .values({
      organizationId: installation.organizationId,
      installationId: installation.id,
      memberId,
    })
    .onConflictDoUpdate({
      target: [appAssignments.installationId, appAssignments.memberId],
      set: {
        deletedAt: null,
        grantVersion: sql`case when ${appAssignments.deletedAt} is null
          then ${appAssignments.grantVersion} else gen_random_uuid() end`,
      },
    })
    .returning({ id: appAssignments.id });
  await transaction
    .delete(appAssignmentRoles)
    .where(eq(appAssignmentRoles.assignmentId, assignmentId));

  if (roleIds.length > emptyLength) {
    await transaction.insert(appAssignmentRoles).values(
      roleIds.map(({ id }) => ({
        installationId: installation.id,
        assignmentId,
        roleId: id,
      })),
    );
  }
}

/**
 * Grants access with the specified roles or revokes a member's app assignment.
 * An empty role list grants sign-in access without product permissions.
 * @param {TransactionRunner} database - Shared IAM database or existing transaction.
 * @param {AccessManager} manager - Authenticated actor and target installation.
 * @param {AssignmentInput} input - Target membership and grant or revoke operation.
 * @returns {Promise<void>} Resolves after saving the assignment and audit event.
 * @throws {Error} Invalid input, unavailable member or role, unauthorized actor, or database failure.
 */
export async function changeApplicationAssignment(
  database: TransactionRunner,
  manager: AccessManager,
  input: AssignmentInput,
): Promise<void> {
  const assignment = valibot.parse(applicationAssignmentInputSchema, input);
  await database.transaction(async (transaction) => {
    const installation = await lockManagedInstallation(transaction, manager);

    if (assignment.action === 'revoke') {
      await revokeAssignment(transaction, manager, assignment.memberId);
      return;
    }

    const roleKeys = [...new Set(assignment.roleKeys)];
    await grantAssignment(transaction, installation, assignment.memberId, roleKeys);
    await recordAccessChange(transaction, manager, 'assignment.granted', {
      memberId: assignment.memberId,
      roleKeys,
    });
  });
}
