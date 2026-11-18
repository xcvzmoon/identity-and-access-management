import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { SQL } from 'drizzle-orm';
import type { Auth, AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { hasRecentAdminVerification } from './admin-passkeys.ts';
import { withAuthAdapter } from './auth-adapter-scope.ts';
import { createAuth } from './auth.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Database = Pick<
  ReturnType<typeof useDatabase>,
  'insert' | 'select' | 'selectDistinct' | 'transaction' | 'query'
>;
type Reader = Pick<Database, 'select'>;
type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
type Invitation = { id: string; email: string; expiresAt: Date };
type InvitationNotice = {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  email: string;
};
type Actor = { session: Session; headers: Headers };

const endpointPath = '/account/organization-invitations';
const rateWindowSeconds = 60;
const rateMaximum = 30;
const maxEmailLength = 254;
const listLimit = 30;
const firstRow = 0;
const extraRow = 1;
const { invitations, organizations, sessions, users } = schema;
const uuid = valibot.pipe(valibot.string(), valibot.uuid());
const email = valibot.pipe(
  valibot.string('Enter an email address.'),
  valibot.trim(),
  valibot.maxLength(maxEmailLength, 'The email address is too long.'),
  valibot.email('Enter a valid email address.'),
  valibot.toLowerCase(),
);

const requestSchema = valibot.variant('action', [
  valibot.strictObject({
    action: valibot.literal('list-mine'),
    cursor: valibot.optional(uuid),
  }),
  valibot.strictObject({
    action: valibot.literal('accept'),
    invitationId: uuid,
  }),
  valibot.strictObject({
    action: valibot.literal('list-pending'),
    organizationId: uuid,
    cursor: valibot.optional(uuid),
  }),
  valibot.strictObject({
    action: valibot.literal('invite'),
    organizationId: uuid,
    email,
  }),
  valibot.strictObject({
    action: valibot.literal('cancel'),
    organizationId: uuid,
    invitationId: uuid,
  }),
]);

type InvitationAction = valibot.InferOutput<typeof requestSchema>;
type AdminAction = Extract<InvitationAction, { action: 'list-pending' | 'invite' | 'cancel' }>;
type InvitationPage<Item> = { items: Item[]; nextCursor: string | null };
type AccountInvitation = { id: string; organizationName: string; expiresAt: Date };

function invitationPage<Item extends { id: string }>(rows: Item[]): InvitationPage<Item> {
  const items = rows.slice(firstRow, listLimit);
  return {
    items,
    nextCursor: rows.length > listLimit ? (items.at(listLimit - extraRow)?.id ?? null) : null,
  };
}

function pendingInvitation(): SQL | undefined {
  return and(
    eq(invitations.status, 'pending'),
    eq(invitations.role, 'member'),
    gt(invitations.expiresAt, sql`now()`),
  );
}

async function readVerifiedEmail(
  database: Reader,
  userId: string,
  mode: 'read' | 'lock' = 'read',
): Promise<string> {
  const query = database
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.emailVerified, true), isNull(users.deletedAt)));
  const usersFound = await (mode === 'lock' ? query.for('share') : query);
  const user = usersFound.at(firstRow);
  if (!user) {
    throw new APIError('FORBIDDEN', { code: 'EMAIL_VERIFICATION_REQUIRED' });
  }

  return user.email;
}

async function lockRecipientSession(database: Reader, actor: Actor): Promise<void> {
  const records = await database
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, actor.session.session.id),
        eq(sessions.userId, actor.session.user.id),
        gt(sessions.expiresAt, sql`now()`),
        isNull(sessions.deletedAt),
      ),
    )
    .for('update');

  if (!records.at(firstRow)) {
    throw new APIError('UNAUTHORIZED');
  }
}

async function listMine(
  database: Reader,
  actor: Actor,
  cursor: string | undefined,
): Promise<InvitationPage<AccountInvitation>> {
  const recipient = await readVerifiedEmail(database, actor.session.user.id);
  const rows = await database
    .select({
      id: invitations.id,
      organizationName: organizations.name,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(
      and(
        eq(invitations.email, recipient),
        isNull(organizations.disabledAt),
        pendingInvitation(),
        ...(cursor ? [gt(invitations.id, cursor)] : []),
      ),
    )
    .orderBy(asc(invitations.id))
    .limit(listLimit + extraRow);

  return invitationPage(rows);
}

async function listPending(
  database: Reader,
  organizationId: string,
  cursor: string | undefined,
): Promise<InvitationPage<Invitation>> {
  const rows = await database
    .select({
      id: invitations.id,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        pendingInvitation(),
        ...(cursor ? [gt(invitations.id, cursor)] : []),
      ),
    )
    .orderBy(asc(invitations.id))
    .limit(listLimit + extraRow);

  return invitationPage(rows);
}

async function lockActiveOrganization(database: Reader, id: string): Promise<string> {
  const records = await database
    .select({ name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.id, id), isNull(organizations.disabledAt)))
    .for('update');
  const organization = records.at(firstRow);
  if (!organization) {
    throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
  }

  return organization.name;
}

async function acceptInvitation(
  database: Database,
  options: AuthOptions,
  actor: Actor,
  invitationId: string,
): Promise<{ organizationId: string; memberId: string }> {
  return database.transaction(async (transaction) => {
    await lockRecipientSession(transaction, actor);
    const recipient = await readVerifiedEmail(transaction, actor.session.user.id);
    const candidates = await transaction
      .select({ organizationId: invitations.organizationId })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.email, recipient),
          pendingInvitation(),
        ),
      );
    const invitation = candidates.at(firstRow);
    if (!invitation) {
      throw new APIError('BAD_REQUEST', { code: 'INVITATION_UNAVAILABLE' });
    }

    await lockActiveOrganization(transaction, invitation.organizationId);

    if ((await readVerifiedEmail(transaction, actor.session.user.id, 'lock')) !== recipient) {
      throw new APIError('FORBIDDEN', { code: 'EMAIL_VERIFICATION_REQUIRED' });
    }

    const auth = createAuth(transaction, options);
    const accepted = await withAuthAdapter(auth, async () =>
      auth.api.acceptInvitation({
        headers: actor.headers,
        body: { invitationId },
      }),
    );

    return {
      organizationId: invitation.organizationId,
      memberId: accepted.member.id,
    };
  });
}

async function administerInvitation(
  database: Database,
  options: AuthOptions,
  actor: Actor,
  action: AdminAction,
): Promise<InvitationPage<Invitation> | InvitationNotice | { canceled: true }> {
  return database.transaction(async (transaction) => {
    const { organizationId } = action;

    if (!(await hasRecentAdminVerification(transaction, actor.session, 'lock'))) {
      throw new APIError('FORBIDDEN', { code: 'PASSKEY_REQUIRED' });
    }

    if (action.action === 'list-pending') {
      if (!(await lockOrganizationAdmin(transaction, organizationId, actor.session.user.id))) {
        throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
      }

      return listPending(transaction, organizationId, action.cursor);
    }

    const organizationName = await lockActiveOrganization(transaction, organizationId);

    if (!(await lockOrganizationAdmin(transaction, organizationId, actor.session.user.id))) {
      throw new APIError('FORBIDDEN', { code: 'ORGANIZATION_UNAVAILABLE' });
    }

    const auth = createAuth(transaction, options);

    if (action.action === 'invite') {
      const invitation = await withAuthAdapter(auth, async () =>
        auth.api.createInvitation({
          headers: actor.headers,
          body: {
            organizationId,
            role: 'member',
            email: action.email,
          },
        }),
      );
      return {
        invitationId: invitation.id,
        organizationId,
        organizationName,
        email: invitation.email,
      };
    }

    const matches = await transaction
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, action.invitationId),
          eq(invitations.organizationId, organizationId),
          pendingInvitation(),
        ),
      );

    if (!matches.at(firstRow)) {
      throw new APIError('BAD_REQUEST', { code: 'INVITATION_UNAVAILABLE' });
    }

    await withAuthAdapter(auth, async () =>
      auth.api.cancelInvitation({
        headers: actor.headers,
        body: { invitationId: action.invitationId },
      }),
    );
    return { canceled: true };
  });
}

async function sendNotice(options: AuthOptions, invitation: InvitationNotice): Promise<boolean> {
  if (!options.sendOrganizationInvitation) {
    return false;
  }

  try {
    await options.sendOrganizationInvitation({
      email: invitation.email,
      organizationName: invitation.organizationName,
    });
    return true;
  } catch {
    console.warn('AUTH_ORGANIZATION_INVITATION_DELIVERY_FAILED');
    return false;
  }
}

export function organizationInvitations(
  database: Database,
  options: AuthOptions,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'iam-organization-invitations',
    rateLimit: [
      {
        pathMatcher: (path) => path === endpointPath,
        window: rateWindowSeconds,
        max: rateMaximum,
      },
    ],
    endpoints: {
      organizationInvitations: createAuthEndpoint(
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
          if (!session) {
            throw new APIError('UNAUTHORIZED');
          }

          const actor = { session, headers };
          const action = context.body;
          if (action.action === 'list-mine') {
            return context.json(await listMine(database, actor, action.cursor));
          }

          if (action.action === 'accept') {
            const accepted = await acceptInvitation(database, options, actor, action.invitationId);
            console.info('AUTH_ORGANIZATION_INVITATION_ACCEPTED', {
              actorId: session.user.id,
              invitationId: action.invitationId,
              ...accepted,
            });
            return context.json(accepted);
          }

          const result = await administerInvitation(database, options, actor, action);
          if ('invitationId' in result) {
            console.info('AUTH_ORGANIZATION_INVITATION_CREATED', {
              actorId: session.user.id,
              organizationId: result.organizationId,
              invitationId: result.invitationId,
            });
            return context.json({
              invitationId: result.invitationId,
              notified: await sendNotice(options, result),
            });
          }

          if (action.action === 'cancel') {
            console.info('AUTH_ORGANIZATION_INVITATION_CANCELED', {
              actorId: session.user.id,
              organizationId: action.organizationId,
              invitationId: action.invitationId,
            });
          }

          return context.json(result);
        },
      ),
    },
  };
}
