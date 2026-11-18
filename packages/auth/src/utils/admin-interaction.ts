import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { Auth, AuthOptions } from './auth.ts';
import {
  ApplicationAccessError,
  applicationAssignmentInputSchema,
  applicationPermissionKeysSchema,
  applicationRoleInputSchema,
  changeApplicationAssignment,
  registerApplicationPermissions,
  saveApplicationRole,
  schema,
} from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import {
  authenticationResponseSchema,
  hasRecentAdminVerification,
  registrationResponseSchema,
  runAdminPasskeyAction,
} from './admin-passkeys.ts';
import { applicationCallbackSchema } from './application-callback.ts';
import { applicationClientIdSchema, manageApplicationClient } from './manage-application-client.ts';
import { manageApplicationMachineKey } from './manage-application-machine-key.ts';
import { applicationClientAuthMethodSchema, registerApplication } from './register-application.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'insert' | 'select' | 'transaction'>;

const firstRow = 0;
const rateWindowSeconds = 60;
const rateMaximum = 15;
const passwordCheckWindowMs = 60_000;
const passwordCheckMaximum = 5;
const maxPasswordLength = 128;
const maxNameLength = 120;
const uuidSchema = valibot.pipe(valibot.string(), valibot.uuid());
const machineKeyOperationSchema = valibot.variant('action', [
  valibot.object({
    action: valibot.literal('issue'),
    installationId: uuidSchema,
  }),
  valibot.object({
    action: valibot.picklist(['rotate', 'revoke']),
    installationId: uuidSchema,
    keyId: uuidSchema,
  }),
]);
const clientActionSchema = valibot.variant('action', [
  valibot.object({ action: valibot.literal('context') }),
  valibot.object({
    action: valibot.literal('begin-enrollment'),
    password: valibot.pipe(
      valibot.string(),
      valibot.nonEmpty(),
      valibot.maxLength(maxPasswordLength),
    ),
  }),
  valibot.object({
    action: valibot.literal('finish-enrollment'),
    response: registrationResponseSchema,
  }),
  valibot.object({ action: valibot.literal('begin-verification') }),
  valibot.object({
    action: valibot.literal('finish-verification'),
    response: authenticationResponseSchema,
  }),
  valibot.object({
    action: valibot.literal('register-app'),
    organizationId: uuidSchema,
    name: valibot.pipe(valibot.string(), valibot.nonEmpty(), valibot.maxLength(maxNameLength)),
    redirectUri: applicationCallbackSchema,
    tokenEndpointAuthMethod: valibot.optional(applicationClientAuthMethodSchema),
  }),
  valibot.object({
    action: valibot.literal('manage-client'),
    clientId: applicationClientIdSchema,
    operation: valibot.picklist(['disable', 'rotate-secret']),
    expectedVersion: valibot.optional(uuidSchema),
  }),
  valibot.strictObject({
    action: valibot.literal('replace-callback'),
    clientId: applicationClientIdSchema,
    expectedVersion: uuidSchema,
    redirectUri: applicationCallbackSchema,
  }),
  valibot.object({
    action: valibot.literal('manage-machine-key'),
    change: machineKeyOperationSchema,
  }),
  valibot.strictObject({
    action: valibot.literal('register-permissions'),
    installationId: uuidSchema,
    permissionKeys: applicationPermissionKeysSchema,
  }),
  valibot.strictObject({
    action: valibot.literal('save-role'),
    installationId: uuidSchema,
    role: applicationRoleInputSchema,
  }),
  valibot.strictObject({
    action: valibot.literal('change-assignment'),
    installationId: uuidSchema,
    change: applicationAssignmentInputSchema,
  }),
]);

type AdminAction = valibot.InferOutput<typeof clientActionSchema>;
type AppAccessOperation = Extract<
  AdminAction,
  { action: 'register-permissions' | 'save-role' | 'change-assignment' }
>;
type AdminOperation =
  | Extract<
      AdminAction,
      { action: 'register-app' | 'manage-client' | 'manage-machine-key' | 'replace-callback' }
    >
  | AppAccessOperation;
type AdminOrganization = { id: string; name: string; owner: boolean };
type AdminActor = { id: string; headers: Headers };

async function listManagedOrganizations(
  database: Database,
  userId: string,
): Promise<AdminOrganization[]> {
  const organizations = await database
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      role: schema.members.role,
    })
    .from(schema.members)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.members.organizationId))
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(
      and(
        eq(schema.users.id, userId),
        eq(schema.users.emailVerified, true),
        isNull(schema.users.deletedAt),
        isNull(schema.organizations.disabledAt),
        isNull(schema.members.suspendedAt),
      ),
    );

  return organizations.flatMap(({ id, name, role }) => {
    const roles = role.split(',');
    const owner = roles.includes('owner');
    return owner || roles.includes('admin') ? [{ id, name, owner }] : [];
  });
}

async function runAppAccessOperation(
  database: Database,
  actorId: string,
  operation: AppAccessOperation,
): Promise<{ action: AppAccessOperation['action'] }> {
  const manager = {
    actorId,
    installationId: operation.installationId,
  };

  try {
    if (operation.action === 'register-permissions') {
      await registerApplicationPermissions(database, manager, operation.permissionKeys);
    } else if (operation.action === 'save-role') {
      await saveApplicationRole(database, manager, operation.role);
    } else {
      await changeApplicationAssignment(database, manager, operation.change);
    }
  } catch (error) {
    if (!(error instanceof ApplicationAccessError)) {
      throw error;
    }

    const status = error.code === 'APP_ACCESS_FORBIDDEN' ? 'FORBIDDEN' : 'BAD_REQUEST';
    throw new APIError(status, { code: error.code });
  }

  return { action: operation.action };
}

async function runAdminOperation(
  database: Database,
  options: AuthOptions,
  actor: AdminActor,
  operation: AdminOperation,
): Promise<object> {
  if (operation.action === 'register-app') {
    return registerApplication(database, options, actor.headers, operation);
  }

  if (operation.action === 'manage-client') {
    return manageApplicationClient(database, options, actor.headers, {
      clientId: operation.clientId,
      action: operation.operation,
      expectedVersion: operation.expectedVersion,
    });
  }

  if (operation.action === 'replace-callback') {
    return manageApplicationClient(database, options, actor.headers, operation);
  }

  if (operation.action === 'manage-machine-key') {
    return manageApplicationMachineKey(database, options, actor.headers, operation.change);
  }

  return runAppAccessOperation(database, actor.id, operation);
}

async function reservePasswordCheck(database: Database, userId: string): Promise<boolean> {
  const { rateLimits } = schema;
  const now = Date.now();
  const firstAttempt = 1;
  const windowExpired = lt(rateLimits.lastRequest, now - passwordCheckWindowMs);
  const attempts = await database
    .insert(rateLimits)
    .values({
      key: `iam:admin-password-check:${userId}`,
      count: firstAttempt,
      lastRequest: now,
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${windowExpired} then ${firstAttempt} else ${rateLimits.count} + 1 end`,
        lastRequest: sql`case when ${windowExpired} then ${now} else ${rateLimits.lastRequest} end`,
      },
      setWhere: or(windowExpired, lt(rateLimits.count, passwordCheckMaximum)),
    })
    .returning({ id: rateLimits.id });

  return Boolean(attempts.at(firstRow));
}

export function adminInteraction(
  database: Database,
  options: AuthOptions,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'iam-admin-interaction',
    rateLimit: [
      {
        pathMatcher: (path) => path === '/admin/interaction',
        window: rateWindowSeconds,
        max: rateMaximum,
      },
    ],
    endpoints: {
      adminInteraction: createAuthEndpoint(
        '/admin/interaction',
        {
          method: 'POST',
          body: clientActionSchema,
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

          const organizations = await listManagedOrganizations(database, session.user.id);
          if (!organizations.at(firstRow)) {
            throw new APIError('FORBIDDEN');
          }

          const action = context.body;
          if (
            action.action === 'begin-enrollment' &&
            !(await reservePasswordCheck(database, session.user.id))
          ) {
            throw new APIError('TOO_MANY_REQUESTS', { code: 'ADMIN_PASSWORD_CHECK_RATE_LIMITED' });
          }

          if (action.action === 'context') {
            const [passkey] = await database
              .select({ id: schema.passkeys.id })
              .from(schema.passkeys)
              .where(eq(schema.passkeys.userId, session.user.id));
            return context.json({
              organizations,
              enrolled: Boolean(passkey),
              verified: await hasRecentAdminVerification(database, session),
            });
          }

          if (
            action.action === 'begin-enrollment' ||
            action.action === 'finish-enrollment' ||
            action.action === 'begin-verification' ||
            action.action === 'finish-verification'
          ) {
            const result = await runAdminPasskeyAction(database, options, headers, action);
            return Response.json(result.data, { headers: result.headers });
          }

          const result = await database.transaction(async (transaction) => {
            if (!(await hasRecentAdminVerification(transaction, session, 'lock'))) {
              throw new APIError('FORBIDDEN', { code: 'PASSKEY_REQUIRED' });
            }

            return runAdminOperation(
              transaction,
              options,
              {
                id: session.user.id,
                headers,
              },
              action,
            );
          });

          return context.json(result);
        },
      ),
    },
  };
}
