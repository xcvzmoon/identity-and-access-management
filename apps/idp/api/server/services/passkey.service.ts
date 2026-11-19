import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { type H3Event, readBody } from 'nitro/h3';
import { constants } from 'node:http2';
import * as valibot from 'valibot';
import { useDatabase } from '../database/index.ts';
import { memberships, passkeys, sessions, users } from '../database/schema.ts';
import { createAuth, useAuth } from '../utils/auth.ts';
import { useEnv } from '../utils/env.ts';
import { BadRequestError, ForbiddenError } from '../utils/http-errors.ts';
import {
  authHeaders,
  checkAuthPost,
  forwardGetRequestToBetterAuth,
  privateResponse,
} from './auth.service.ts';

type Ceremony = 'registration' | 'authentication';
type Database = Omit<ReturnType<typeof useDatabase>, '$client'>;

const EMPTY_RESULT_COUNT = 0;
const SINGLE_ROW = 1;

const challengeSchema = valibot.object({ challenge: valibot.string() });
const credentialSchema = valibot.object({
  response: valibot.looseObject({
    id: valibot.string(),
    response: valibot.looseObject({ clientDataJSON: valibot.string() }),
  }),
});
const verifiedSessionSchema = valibot.object({
  session: valibot.object({
    id: valibot.string(),
    userId: valibot.string(),
  }),
});

/**
 * Requires a live session that verified a passkey within the last five minutes.
 *
 * @param {string} userId - Authenticated user ID.
 * @param {string} sessionId - IAM session ID from authenticated context.
 * @param {Database} [database] - Transaction that will perform the protected operation.
 * @throws {ForbiddenError} If the session lacks a current verification.
 */
export async function requireFreshStepUp(
  userId: string,
  sessionId: string,
  database: Database = useDatabase(),
): Promise<void> {
  const matchingSessions = await database
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, sql`clock_timestamp()`),
        gt(sessions.passkeyVerifiedAt, sql`clock_timestamp() - interval '5 minutes'`),
      ),
    )
    .for('update');

  if (matchingSessions.length === EMPTY_RESULT_COUNT) {
    throw new ForbiddenError('Verify a passkey for this IAM session.');
  }
}

async function getActor(event: H3Event): Promise<{ userId: string; sessionId: string }> {
  const auth = useAuth();
  const actor = await auth.api.getSession({
    headers: authHeaders(event),
    query: {
      disableCookieCache: true,
      disableRefresh: true,
    },
  });

  if (!actor?.user.emailVerified) {
    throw new ForbiddenError('Sign in with a verified account.');
  }

  return {
    userId: actor.user.id,
    sessionId: actor.session.id,
  };
}

async function requireEnrollmentAccess(
  database: Database,
  userId: string,
  sessionId: string,
): Promise<void> {
  const env = useEnv();
  const administrativeMemberships = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), inArray(memberships.role, ['owner', 'admin'])))
    .limit(SINGLE_ROW);

  if (
    administrativeMemberships.length === EMPTY_RESULT_COUNT &&
    !env.operatorUserIds.includes(userId)
  ) {
    throw new ForbiddenError('Administrative membership is required.');
  }

  const existingPasskeys = await database
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .limit(SINGLE_ROW);

  if (existingPasskeys.length > EMPTY_RESULT_COUNT) {
    await requireFreshStepUp(userId, sessionId, database);
  }
}

/**
 * Issues an IdP WebAuthn challenge bound to the signed-in user's IAM session.
 *
 * @param {H3Event} event - Request at the IdP origin.
 * @param {Ceremony} ceremony - Registration enrolls a key and authentication verifies it.
 * @returns {Promise<Response>} Challenge options and Better Auth's signed challenge cookie.
 */
export async function startPasskey(event: H3Event, ceremony: Ceremony): Promise<Response> {
  const database = useDatabase();
  const actor = await getActor(event);

  if (ceremony === 'registration') {
    await requireEnrollmentAccess(database, actor.userId, actor.sessionId);
  }

  const response = await forwardGetRequestToBetterAuth(event);
  if (response.ok) {
    const { challenge } = valibot.parse(challengeSchema, await response.clone().json());
    await database
      .update(sessions)
      .set({ passkeyChallenge: challenge })
      .where(eq(sessions.id, actor.sessionId));
  }

  return response;
}

function readChallenge(clientData: string): string {
  try {
    const data: unknown = JSON.parse(Buffer.from(clientData, 'base64url').toString('utf8'));
    return valibot.parse(challengeSchema, data).challenge;
  } catch {
    throw new BadRequestError('Invalid WebAuthn client data.');
  }
}

/**
 * Verifies a session-bound WebAuthn response and preserves the browser's original IAM session.
 *
 * @param {H3Event} event - Request at the IdP origin.
 * @param {Ceremony} ceremony - Registration enrolls a key and authentication verifies it.
 * @returns {Promise<Response>} An empty success response or Better Auth's verification error.
 */
export async function finishPasskey(event: H3Event, ceremony: Ceremony): Promise<Response> {
  checkAuthPost(event);

  const database = useDatabase();
  const env = useEnv();
  const actor = await getActor(event);
  const parsed = valibot.safeParse(credentialSchema, await readBody<unknown>(event));
  if (!parsed.success) {
    throw new BadRequestError('Invalid WebAuthn response.');
  }

  const credential = parsed.output.response;
  const challenge = readChallenge(credential.response.clientDataJSON);

  return database.transaction(async (transaction) => {
    await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actor.userId))
      .for('update');

    const matchingSessions = await transaction
      .update(sessions)
      .set({ passkeyChallenge: null })
      .where(
        and(
          eq(sessions.id, actor.sessionId),
          eq(sessions.userId, actor.userId),
          eq(sessions.passkeyChallenge, challenge),
          gt(sessions.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .returning({ id: sessions.id });

    if (matchingSessions.length === EMPTY_RESULT_COUNT) {
      throw new ForbiddenError('Start a new passkey challenge in this session.');
    }

    if (ceremony === 'registration') {
      await requireEnrollmentAccess(transaction, actor.userId, actor.sessionId);
    } else {
      const ownedCredentials = await transaction
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(and(eq(passkeys.userId, actor.userId), eq(passkeys.credentialID, credential.id)))
        .for('update');

      if (ownedCredentials.length === EMPTY_RESULT_COUNT) {
        throw new ForbiddenError('Choose a passkey belonging to this account.');
      }
    }

    const auth = createAuth(transaction);
    const headers = authHeaders(event);
    headers.delete('content-length');

    const request = new Request(new URL(event.url.pathname, env.oidcIssuerUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ response: credential }),
    });
    const response = await auth.handler(request);

    if (!response.ok) {
      return privateResponse(response);
    }

    if (ceremony === 'authentication') {
      const verified = valibot.parse(verifiedSessionSchema, await response.json());
      if (verified.session.userId !== actor.userId || verified.session.id === actor.sessionId) {
        throw new ForbiddenError('Unexpected passkey session.');
      }

      await transaction.delete(sessions).where(eq(sessions.id, verified.session.id));
      await transaction
        .update(sessions)
        .set({ passkeyVerifiedAt: sql`clock_timestamp()` })
        .where(eq(sessions.id, actor.sessionId));
    }

    return privateResponse(new Response(null, { status: constants.HTTP_STATUS_NO_CONTENT }));
  });
}
