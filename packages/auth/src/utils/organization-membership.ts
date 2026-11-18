import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { Auth, AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { hasRecentAdminVerification } from './admin-passkeys.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Transaction = Pick<ReturnType<typeof useDatabase>, 'select' | 'update' | 'insert'>;
type MembershipStatus = 'suspended' | 'active';
type MembershipChange = {
  organizationId: string;
  memberId: string;
  status: MembershipStatus;
};
type MembershipResult = { status: MembershipStatus; changed: boolean };
type Database = Pick<ReturnType<typeof useDatabase>, 'transaction'>;

const firstRow = 0;
const empty = 0;
const windowSeconds = 60;
const maximumRequests = 20;
const endpointPath = '/admin/member-status';
const { members, appAssignments, appAccessEvents } = schema;
const uuid = valibot.pipe(valibot.string(), valibot.uuid());
const requestSchema = valibot.strictObject({
  organizationId: uuid,
  memberId: uuid,
  status: valibot.picklist(['suspended', 'active']),
});

async function setMemberStatus(
  transaction: Transaction,
  actorId: string,
  change: MembershipChange,
): Promise<MembershipResult> {
  const { organizationId, memberId, status } = change;

  if (!(await lockOrganizationAdmin(transaction, organizationId, actorId))) {
    throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
  }

  const target = and(
    eq(members.id, memberId),
    eq(members.organizationId, organizationId),
    eq(members.role, 'member'),
  );
  const matches = await transaction
    .select({ suspendedAt: members.suspendedAt })
    .from(members)
    .where(target)
    .for('update');
  const member = matches.at(firstRow);
  if (!member) {
    throw new APIError('BAD_REQUEST', { code: 'ORGANIZATION_MEMBER_UNAVAILABLE' });
  }

  const suspend = status === 'suspended';
  if (Boolean(member.suspendedAt) === suspend) {
    return {
      status,
      changed: false,
    };
  }

  await transaction
    .update(members)
    .set({ suspendedAt: suspend ? sql`now()` : null })
    .where(target);

  if (suspend) {
    const assignments = await transaction
      .update(appAssignments)
      .set({ grantVersion: sql`gen_random_uuid()` })
      .where(
        and(
          eq(appAssignments.organizationId, organizationId),
          eq(appAssignments.memberId, memberId),
          isNull(appAssignments.deletedAt),
        ),
      )
      .returning({ installationId: appAssignments.installationId });

    if (assignments.length > empty) {
      await transaction.insert(appAccessEvents).values(
        assignments.map(({ installationId }) => ({
          installationId,
          actorId,
          action: 'membership.suspended',
          details: { memberId },
        })),
      );
    }
  }

  return {
    status,
    changed: true,
  };
}

export function organizationMembership(
  database: Database,
  options: AuthOptions,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'iam-organization-membership',
    rateLimit: [
      {
        pathMatcher: (path) => path === endpointPath,
        window: windowSeconds,
        max: maximumRequests,
      },
    ],
    endpoints: {
      organizationMemberStatus: createAuthEndpoint(
        endpointPath,
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

            return setMemberStatus(transaction, session.user.id, context.body);
          });

          if (result.changed) {
            console.info('AUTH_ORGANIZATION_MEMBER_STATUS_CHANGED', {
              actorId: session.user.id,
              organizationId: context.body.organizationId,
              memberId: context.body.memberId,
              status: result.status,
            });
          }

          return context.json(result);
        },
      ),
    },
  };
}
