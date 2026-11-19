import type { H3Event } from 'nitro/h3';
import { decodeBasicCredentials } from '@better-auth/core/oauth2';
import { isAPIError } from 'better-auth/api';
import { makeSignature } from 'better-auth/crypto';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { assertBodySize, readBody } from 'nitro/h3';
import * as valibot from 'valibot';
import { recordManagementAction } from '../../../../../shared/server/api-logging.ts';
import { useDatabase } from '../database/index.ts';
import {
  appGrants,
  appInstallations,
  invitations,
  memberships,
  oauthClients,
  organizations,
  sessions,
  users,
} from '../database/schema.ts';
import { managementCommandSchema, roleCatalogSchema } from '../schemas/management.ts';
import { createAuth, useAuth } from '../utils/auth.ts';
import { useEnv } from '../utils/env.ts';
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
  UnsupportedMediaTypeError,
} from '../utils/http-errors.ts';
import { privateResponse } from './auth.service.ts';
import { CONSOLE_CLIENT_ID } from './authorization.service.ts';
import { requireFreshStepUp } from './passkey.service.ts';
import { assignAppRole, provisionClient, revokeAppGrant } from './registration.service.ts';

type Transaction = Omit<ReturnType<typeof useDatabase>, '$client'>;
type Command = valibot.InferOutput<typeof managementCommandSchema>;
type InstallationCommand = Extract<Command, { clientId: string }>;
type Actor = { userId: string; sessionId: string };

const MAX_BODY_BYTES = 16_384;
const FIRST = 0;

const tokenSchema = valibot.object({
  active: valibot.literal(true),
  client_id: valibot.literal(CONSOLE_CLIENT_ID),
  iam_grant_version: valibot.literal(CONSOLE_CLIENT_ID),
  sub: valibot.pipe(valibot.string(), valibot.uuid()),
  sid: valibot.pipe(valibot.string(), valibot.uuid()),
});

async function authenticateConsole(event: H3Event): Promise<Actor> {
  const credential = event.req.headers.get('authorization');
  const token = event.req.headers.get('x-iam-access-token');
  if (!credential?.startsWith('Basic ') || !token) {
    throw new UnauthorizedError('A console session is required.');
  }

  const auth = useAuth();
  const env = useEnv();
  const request = new Request(new URL('/api/v1/auth/oauth2/introspect', env.oidcIssuerUrl), {
    method: 'POST',
    headers: {
      authorization: credential,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    }),
  });
  const response = await auth.handler(request);
  if (!response.ok) {
    throw new UnauthorizedError('Invalid console credentials.');
  }

  const claims = valibot.safeParse(tokenSchema, await response.json());
  const { clientId } = decodeBasicCredentials(credential);

  if (!claims.success || clientId !== CONSOLE_CLIENT_ID) {
    throw new UnauthorizedError('Invalid console access token.');
  }

  return {
    userId: claims.output.sub,
    sessionId: claims.output.sid,
  };
}

/**
 * Supplies the locked IAM session to server-side Better Auth plugin operations.
 * The console access token identifies the session. Its signed cookie stays in the IdP.
 * @param {string} token - Token from the session row bound to the verified console claims.
 * @returns {Promise<Headers>} Internal request headers for the organization and OAuth plugins.
 */
async function sessionHeaders(token: string): Promise<Headers> {
  const auth = useAuth();
  const context = await auth.$context;
  const signature = await makeSignature(token, context.secret);
  const value = encodeURIComponent(`${token}.${signature}`);
  return new Headers({ cookie: `${context.authCookies.sessionToken.name}=${value}` });
}

async function organizationDetails(tx: Transaction, organizationId: string): Promise<Response> {
  const members = await tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(users.email);
  const invites = await tx
    .select({
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
    })
    .from(invitations)
    .where(eq(invitations.organizationId, organizationId))
    .orderBy(invitations.email);
  const clients = await tx
    .select({
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      metadata: oauthClients.metadata,
    })
    .from(appInstallations)
    .innerJoin(oauthClients, eq(appInstallations.clientId, oauthClients.clientId))
    .where(
      and(eq(appInstallations.organizationId, organizationId), eq(oauthClients.disabled, false)),
    )
    .orderBy(oauthClients.name);
  const assignments = await tx
    .select({
      userId: appGrants.userId,
      clientId: appGrants.clientId,
      role: appGrants.role,
    })
    .from(appGrants)
    .where(eq(appGrants.organizationId, organizationId));
  const installations = clients.map(({ clientId, name, metadata }) => ({
    clientId,
    name,
    rolePermissions: valibot.parse(roleCatalogSchema, metadata).rolePermissions,
  }));

  return Response.json({
    members,
    invitations: invites,
    installations,
    assignments,
  });
}

async function changeInstallation(tx: Transaction, command: InstallationCommand): Promise<void> {
  const { organizationId, clientId } = command;
  const clientRows = await tx
    .select({ metadata: oauthClients.metadata })
    .from(appInstallations)
    .innerJoin(oauthClients, eq(appInstallations.clientId, oauthClients.clientId))
    .where(
      and(
        eq(appInstallations.organizationId, organizationId),
        eq(oauthClients.clientId, clientId),
        eq(oauthClients.disabled, false),
      ),
    )
    .for('update');
  const client = clientRows.at(FIRST);

  if (!client) {
    throw new ForbiddenError('Installation unavailable.');
  }

  const { rolePermissions } = valibot.parse(roleCatalogSchema, client.metadata);

  if (command.action === 'defineRole') {
    await tx
      .update(oauthClients)
      .set({
        metadata: {
          rolePermissions: {
            ...rolePermissions,
            [command.role]: [...new Set(command.permissions)].toSorted(),
          },
        },
      })
      .where(eq(oauthClients.clientId, clientId));

    return;
  }

  if (command.action === 'assign') {
    const memberRows = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.userId, command.userId)),
      );
    const member = memberRows.at(FIRST);
    if (!member || !Object.hasOwn(rolePermissions, command.role)) {
      throw new BadRequestError('Select a member and a defined installation role.');
    }

    await assignAppRole(
      {
        organizationId,
        clientId,
        userId: command.userId,
        role: command.role,
      },
      tx,
    );

    return;
  }

  if (command.action === 'revoke') {
    await revokeAppGrant(command, tx);
    return;
  }
  await tx.update(oauthClients).set({ disabled: true }).where(eq(oauthClients.clientId, clientId));
  await tx
    .delete(appGrants)
    .where(and(eq(appGrants.clientId, clientId), eq(appGrants.organizationId, organizationId)));
}

async function mutateOrganization(
  tx: Transaction,
  command: Exclude<Command, { action: 'list' | 'details' }>,
  headers: Headers,
  actorMembership: Pick<typeof memberships.$inferSelect, 'id' | 'role'>,
): Promise<Response> {
  const auth = createAuth(tx);
  const { organizationId } = command;

  if (command.action === 'register') {
    return Response.json(
      await provisionClient(
        headers,
        {
          kind: 'installation',
          organizationId,
          name: command.name,
          redirectUris: [command.redirectUri],
        },
        tx,
      ),
    );
  }

  if (command.action === 'rename') {
    await auth.api.updateOrganization({
      headers,
      body: {
        organizationId,
        data: { name: command.name },
      },
    });

    return Response.json({ ok: true });
  }

  if (command.action === 'invite') {
    if (command.role === 'admin' && actorMembership.role !== 'owner') {
      throw new ForbiddenError('Only an owner can invite an administrator.');
    }

    await auth.api.createInvitation({
      headers,
      body: {
        organizationId,
        email: command.email,
        role: command.role,
      },
    });

    return Response.json({ ok: true });
  }

  if (command.action === 'removeMember') {
    const memberRows = await tx
      .select({
        id: memberships.id,
        role: memberships.role,
      })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.userId, command.userId)),
      );
    const member = memberRows.at(FIRST);
    if (
      !member ||
      member.id === actorMembership.id ||
      (member.role !== 'member' && actorMembership.role !== 'owner')
    ) {
      throw new ForbiddenError('Member removal is restricted.');
    }

    await auth.api.removeMember({
      headers,
      body: {
        organizationId,
        memberIdOrEmail: member.id,
      },
    });

    return Response.json({ ok: true });
  }

  await changeInstallation(tx, command);

  return Response.json({ ok: true });
}

async function executeCommand(tx: Transaction, actor: Actor, command: Command): Promise<Response> {
  const sessionRows = await tx
    .select({ token: sessions.token })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(users.emailVerified, true),
        eq(users.id, actor.userId),
        eq(sessions.id, actor.sessionId),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .for('update', { of: sessions });
  const session = sessionRows.at(FIRST);

  if (!session) {
    throw new UnauthorizedError('Your IAM session has ended.');
  }

  if (command.action === 'list') {
    const rows = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .where(
        and(eq(memberships.userId, actor.userId), inArray(memberships.role, ['owner', 'admin'])),
      )
      .orderBy(organizations.name);

    return Response.json({ organizations: rows });
  }

  const { organizationId } = command;
  const membershipRows = await tx
    .select({
      id: memberships.id,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, actor.userId),
        eq(memberships.organizationId, organizationId),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    )
    .for('update', { of: [organizations, memberships] });
  const membership = membershipRows.at(FIRST);

  if (!membership) {
    throw new ForbiddenError('Organization administration is restricted.');
  }

  if (command.action === 'details') {
    return organizationDetails(tx, organizationId);
  }

  await requireFreshStepUp(actor.userId, actor.sessionId, tx);

  const headers = await sessionHeaders(session.token);
  return mutateOrganization(tx, command, headers, membership);
}

/**
 * Authorizes a console management command against the issuing IAM session and
 * current organization membership. Mutations also require a recent passkey challenge.
 *
 * @param {H3Event} event - JSON command with console client credentials and its user access token.
 * @returns {Promise<Response>} Private result, including the client secret only at registration.
 */
export async function manageOrganization(event: H3Event): Promise<Response> {
  assertBodySize(event, MAX_BODY_BYTES);

  if (event.req.headers.get('content-type')?.split(';').at(FIRST)?.trim() !== 'application/json') {
    throw new UnsupportedMediaTypeError('Expected a JSON request.');
  }

  const actor = await authenticateConsole(event);
  const parsed = valibot.safeParse(managementCommandSchema, await readBody<unknown>(event));
  if (!parsed.success) {
    throw new BadRequestError('Invalid management command.');
  }

  recordManagementAction(event, parsed.output.action);

  const database = useDatabase();
  try {
    const response = await database.transaction(async (tx) =>
      executeCommand(tx, actor, parsed.output),
    );
    return privateResponse(response);
  } catch (error) {
    if (isAPIError(error)) {
      throw new BadRequestError('The organization operation was declined.');
    }

    throw error;
  }
}
