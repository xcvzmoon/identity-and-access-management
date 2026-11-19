import type { H3Event } from 'nitro/h3';
import { and, eq } from 'drizzle-orm';
import { readBody } from 'nitro/h3';
import { randomUUID } from 'node:crypto';
import * as valibot from 'valibot';
import { useDatabase } from '../database/index.ts';
import {
  invitations,
  memberships,
  organizations,
  ownerRecoveryEvents,
  users,
} from '../database/schema.ts';
import { useAuth } from '../utils/auth.ts';
import { useEnv } from '../utils/env.ts';
import { BadRequestError, ForbiddenError } from '../utils/http-errors.ts';
import { sendAccountEmail } from '../utils/mail.ts';
import { authHeaders, checkAuthPost, privateResponse } from './auth.service.ts';
import { requireFreshStepUp } from './passkey.service.ts';

const FIRST = 0;
const MAX_LABEL_LENGTH = 128;
const INVITATION_TTL_MS = 172_800_000;
const ownerEmail = valibot.pipe(
  valibot.string(),
  valibot.trim(),
  valibot.email(),
  valibot.toLowerCase(),
);
const label = valibot.pipe(
  valibot.string(),
  valibot.trim(),
  valibot.nonEmpty(),
  valibot.maxLength(MAX_LABEL_LENGTH),
);
const requestSchema = valibot.variant('operation', [
  valibot.strictObject({
    operation: valibot.literal('bootstrap'),
    name: label,
    slug: valibot.pipe(label, valibot.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
    ownerEmail,
  }),
  valibot.strictObject({
    operation: valibot.literal('recover'),
    organizationId: valibot.pipe(valibot.string(), valibot.uuid()),
    caseReference: label,
    verifiedOwnerLockout: valibot.literal(true),
    ownerEmail,
  }),
]);

/** Invites the first or replacement owner after the operator completes passkey verification.
 * Recovery requires an independently verified case. The invitation and recovery audit entry
 * commit together after the mail server accepts delivery.
 * @param {H3Event} event - Same-origin request from the operator's current IAM session.
 * @returns {Promise<Response>} Organization ID after the invitation commits.
 */
export async function inviteOwner(event: H3Event): Promise<Response> {
  checkAuthPost(event);

  const auth = useAuth();
  const env = useEnv();
  const session = await auth.api.getSession({ headers: authHeaders(event) });

  if (!session?.user.emailVerified || !env.operatorUserIds.includes(session.user.id)) {
    throw new ForbiddenError('Operator access is required.');
  }

  const parsed = valibot.safeParse(requestSchema, await readBody<unknown>(event));
  if (!parsed.success) {
    throw new BadRequestError('Invalid owner invitation request.');
  }

  const input = parsed.output;
  const database = useDatabase();
  const organizationId = await database.transaction(async (transaction) => {
    await requireFreshStepUp(session.user.id, session.session.id, transaction);

    const id = input.operation === 'bootstrap' ? randomUUID() : input.organizationId;
    if (input.operation === 'bootstrap') {
      const created = await transaction
        .insert(organizations)
        .values({
          id,
          name: input.name,
          slug: input.slug,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: organizations.id });

      if (!created.at(FIRST)) {
        throw new BadRequestError('The organization slug is already in use.');
      }
    } else {
      const targets = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, id))
        .for('update');

      if (!targets.at(FIRST)) {
        throw new BadRequestError('Unknown organization.');
      }

      const existing = await transaction
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.organizationId, id), eq(users.email, input.ownerEmail)));

      if (existing.at(FIRST)) {
        throw new BadRequestError('Use a verified recovery contact who is not an existing member.');
      }

      const recorded = await transaction
        .insert(ownerRecoveryEvents)
        .values({
          organizationId: id,
          operatorId: session.user.id,
          caseReference: input.caseReference,
          outcome: 'invited',
        })
        .onConflictDoNothing()
        .returning({ id: ownerRecoveryEvents.id });

      if (!recorded.at(FIRST)) {
        throw new BadRequestError('This recovery case has already been processed.');
      }

      await transaction
        .update(invitations)
        .set({ status: 'canceled' })
        .where(
          and(
            eq(invitations.organizationId, id),
            eq(invitations.role, 'owner'),
            eq(invitations.status, 'pending'),
          ),
        );
    }

    const token = randomUUID();
    const url = new URL('/invite', env.oidcIssuerUrl);

    url.hash = new URLSearchParams({ token }).toString();

    await transaction.insert(invitations).values({
      id: token,
      organizationId: id,
      inviterId: session.user.id,
      email: input.ownerEmail,
      role: 'owner',
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });
    await sendAccountEmail(
      input.ownerEmail,
      'Accept organization ownership',
      url.href,
      'confirmed',
    );
    return id;
  });

  return privateResponse(Response.json({ organizationId }));
}
