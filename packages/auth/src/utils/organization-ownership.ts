import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { Auth, AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { hasRecentAdminVerification } from './admin-passkeys.ts';
import { isOrganizationOwner, lockOrganizationAdmin } from './organization-admin.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'transaction'>;
type Reader = Pick<ReturnType<typeof useDatabase>, 'select'>;
type Transaction = Pick<ReturnType<typeof useDatabase>, 'select' | 'update'>;
type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

const firstRow = 0;
const transferredMembershipCount = 2;
const rateWindowSeconds = 60;
const maximumRequests = 5;
const endpointPath = '/admin/transfer-ownership';
const memberRolePath = '/admin/member-role';
const uuid = valibot.pipe(valibot.string(), valibot.uuid());
const requestSchema = valibot.strictObject({
  organizationId: uuid,
  memberId: uuid,
});
const roleRequestSchema = valibot.strictObject({
  ...requestSchema.entries,
  role: valibot.picklist(['admin', 'member']),
});
type TransferRequest = valibot.InferOutput<typeof requestSchema>;
type RoleRequest = valibot.InferOutput<typeof roleRequestSchema>;
type Change = 'transfer' | 'promote' | 'demote';
type RoleTarget = { userId: string; role: string };
type RoleResult = { role: RoleRequest['role']; changed: boolean };
type TransferResult = { newOwnerId: string };
const { members, organizations, sessions, users } = schema;

async function readRoleTarget(
  database: Reader,
  request: TransferRequest,
  mode: 'read' | 'lock',
  change: Change,
): Promise<RoleTarget> {
  const query = database
    .select({
      userId: users.id,
      role: members.role,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.id, request.memberId),
        eq(members.organizationId, request.organizationId),
        inArray(members.role, ['member', 'admin']),
        ...(change === 'demote'
          ? []
          : [isNull(members.suspendedAt), eq(users.emailVerified, true)]),
        isNull(users.deletedAt),
      ),
    );
  const recipients = await (mode === 'lock' ? query.for('update') : query);
  const recipient = recipients.at(firstRow);
  if (!recipient) {
    throw new APIError('BAD_REQUEST', {
      code:
        change === 'transfer'
          ? 'OWNERSHIP_RECIPIENT_UNAVAILABLE'
          : 'ORGANIZATION_MEMBER_UNAVAILABLE',
    });
  }

  return recipient;
}

async function lockParticipants(transaction: Reader, userIds: readonly string[]): Promise<void> {
  await transaction
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.userId, userIds))
    .orderBy(asc(sessions.id))
    .for('update');
}

async function lockOrganization(transaction: Reader, organizationId: string): Promise<void> {
  const rows = await transaction
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.disabledAt)))
    .for('update');

  if (!rows.at(firstRow)) {
    throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
  }
}

async function lockOwnerChange(
  transaction: Transaction,
  session: Session,
  request: TransferRequest,
  change: Change,
): Promise<RoleTarget> {
  const actorId = session.user.id;
  const { organizationId } = request;

  if (!(await hasRecentAdminVerification(transaction, session))) {
    throw new APIError('FORBIDDEN', { code: 'PASSKEY_REQUIRED' });
  }

  if (!(await isOrganizationOwner(transaction, organizationId, actorId))) {
    throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
  }

  const requested = await readRoleTarget(transaction, request, 'read', change);
  await lockParticipants(transaction, [actorId, requested.userId]);

  if (!(await hasRecentAdminVerification(transaction, session, 'lock'))) {
    throw new APIError('FORBIDDEN', { code: 'PASSKEY_REQUIRED' });
  }

  await lockOrganization(transaction, organizationId);

  if (!(await lockOrganizationAdmin(transaction, organizationId, actorId, 'owner'))) {
    throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
  }

  const current = await readRoleTarget(transaction, request, 'lock', change);
  if (current.userId !== requested.userId) {
    throw new APIError('CONFLICT', { code: 'ORGANIZATION_MEMBER_CHANGED' });
  }

  return current;
}

async function clearPrivilegedProofs(
  transaction: Transaction,
  userIds: readonly string[],
): Promise<void> {
  await transaction
    .update(sessions)
    .set({
      adminPasskeyId: null,
      adminVerifiedAt: null,
    })
    .where(inArray(sessions.userId, userIds));
}

async function transferOwnership(
  transaction: Transaction,
  session: Session,
  request: TransferRequest,
): Promise<TransferResult> {
  const { userId: newOwnerId } = await lockOwnerChange(transaction, session, request, 'transfer');
  const actorId = session.user.id;
  const { organizationId, memberId } = request;
  const updated = await transaction
    .update(members)
    .set({ role: sql`case when ${eq(members.id, memberId)} then 'owner' else 'admin' end` })
    .where(
      and(
        eq(members.organizationId, organizationId),
        or(eq(members.userId, actorId), eq(members.id, memberId)),
      ),
    )
    .returning({ id: members.id });

  if (updated.length !== transferredMembershipCount) {
    throw new APIError('CONFLICT', { code: 'OWNERSHIP_CHANGED' });
  }

  await clearPrivilegedProofs(transaction, [actorId, newOwnerId]);
  return { newOwnerId };
}

async function setMemberRole(
  transaction: Transaction,
  session: Session,
  request: RoleRequest,
): Promise<RoleResult> {
  const { role, organizationId, memberId } = request;
  const target = await lockOwnerChange(
    transaction,
    session,
    request,
    role === 'admin' ? 'promote' : 'demote',
  );
  const changed = target.role !== role;
  if (changed) {
    await transaction
      .update(members)
      .set({ role })
      .where(and(eq(members.organizationId, organizationId), eq(members.id, memberId)));
    await clearPrivilegedProofs(transaction, [target.userId]);
  }

  return { role, changed };
}

async function requireAdminSession(
  headers: Headers | undefined,
  origin: string,
  auth: Auth,
): Promise<Session> {
  if (
    headers?.get('origin') !== origin ||
    headers.has('authorization') ||
    headers.has('x-api-key')
  ) {
    throw new APIError('FORBIDDEN');
  }

  const session = await auth.api.getSession({ headers });
  if (!session?.user.emailVerified) {
    throw new APIError('UNAUTHORIZED');
  }

  return session;
}

export function organizationOwnership(
  database: Database,
  options: AuthOptions,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'iam-organization-ownership',
    rateLimit: [
      {
        pathMatcher: (path) => path === endpointPath || path === memberRolePath,
        window: rateWindowSeconds,
        max: maximumRequests,
      },
    ],
    endpoints: {
      organizationMemberRole: createAuthEndpoint(
        memberRolePath,
        {
          method: 'POST',
          body: roleRequestSchema,
        },
        async (context) => {
          const session = await requireAdminSession(context.headers, options.webOrigin, useAuth());
          const result = await database.transaction(async (transaction) =>
            setMemberRole(transaction, session, context.body),
          );

          if (result.changed) {
            console.info('AUTH_ORGANIZATION_MEMBER_ROLE_CHANGED', {
              actorId: session.user.id,
              organizationId: context.body.organizationId,
              memberId: context.body.memberId,
              role: result.role,
            });
          }

          return context.json(result);
        },
      ),
      organizationTransferOwnership: createAuthEndpoint(
        endpointPath,
        {
          method: 'POST',
          body: requestSchema,
        },
        async (context) => {
          const session = await requireAdminSession(context.headers, options.webOrigin, useAuth());
          const result = await database.transaction(async (transaction) =>
            transferOwnership(transaction, session, context.body),
          );
          console.info('AUTH_ORGANIZATION_OWNERSHIP_TRANSFERRED', {
            actorId: session.user.id,
            organizationId: context.body.organizationId,
            memberId: context.body.memberId,
            ...result,
          });
          return context.json({ transferred: true });
        },
      ),
    },
  };
}
