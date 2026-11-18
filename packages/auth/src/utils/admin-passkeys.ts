import type { useDatabase } from '@iam/database';
import type { Auth, AuthOptions } from './auth.ts';
import { passkey } from '@better-auth/passkey';
import { schema } from '@iam/database';
import { APIError } from 'better-auth/api';
import { and, eq, gt, isNull } from 'drizzle-orm';
import * as valibot from 'valibot';
import { withAuthAdapter } from './auth-adapter-scope.ts';
import { createAuth } from './auth.ts';

type Database = ReturnType<typeof useDatabase>;
type PasskeyDatabase = Pick<Database, 'select' | 'transaction'>;
type AuthorizedSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
const credentialIdSchema = valibot.pipe(valibot.string(), valibot.nonEmpty());
const transportList = valibot.array(valibot.string());
const webAuthnCredential = {
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: valibot.literal('public-key'),
  clientExtensionResults: valibot.object({}),
};
export const registrationResponseSchema = valibot.object({
  ...webAuthnCredential,
  response: valibot.object({
    clientDataJSON: credentialIdSchema,
    attestationObject: credentialIdSchema,
    transports: valibot.optional(transportList),
  }),
});
export const authenticationResponseSchema = valibot.object({
  ...webAuthnCredential,
  response: valibot.object({
    clientDataJSON: credentialIdSchema,
    authenticatorData: credentialIdSchema,
    signature: credentialIdSchema,
    userHandle: valibot.optional(valibot.string()),
  }),
});
type AuthenticationResponse = valibot.InferOutput<typeof authenticationResponseSchema>;
type RegistrationResponse = valibot.InferOutput<typeof registrationResponseSchema>;
type AdminPasskeyAction =
  | { action: 'begin-enrollment'; password: string }
  | { action: 'finish-enrollment'; response: RegistrationResponse }
  | { action: 'begin-verification' }
  | { action: 'finish-verification'; response: AuthenticationResponse };

const maxVerificationAgeMs = 300_000;
const firstRow = 0;
const minimumPasskeys = 1;

export function administratorPasskeys(origin: string): ReturnType<typeof passkey> {
  return passkey({
    rpID: new URL(origin).hostname,
    rpName: 'Identity and Access Management',
    origin,
    authenticatorSelection: { userVerification: 'required' },
    registration: {
      afterVerification: ({ ctx, context }) => {
        if (!ctx.context.session || context !== ctx.context.session.session.id) {
          throw new APIError('UNAUTHORIZED');
        }
      },
    },
  });
}

export async function hasRecentAdminVerification(
  database: Pick<Database, 'select'>,
  session: AuthorizedSession,
  mode: 'inspect' | 'lock' = 'inspect',
): Promise<boolean> {
  const minimumTime = new Date(Date.now() - maxVerificationAgeMs);
  const query = database
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .innerJoin(schema.passkeys, eq(schema.passkeys.id, schema.sessions.adminPasskeyId))
    .where(
      and(
        eq(schema.sessions.id, session.session.id),
        eq(schema.sessions.userId, session.user.id),
        eq(schema.passkeys.userId, session.user.id),
        gt(schema.sessions.expiresAt, new Date()),
        gt(schema.sessions.adminVerifiedAt, minimumTime),
        isNull(schema.sessions.deletedAt),
      ),
    );
  const verifiedSessions = await (mode === 'lock' ? query.for('share') : query);
  return verifiedSessions.length >= minimumPasskeys;
}

async function protectPasskeyEnrollment(
  transaction: Pick<Database, 'select'>,
  session: AuthorizedSession,
): Promise<void> {
  await transaction
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .for('update');
  const enrolled = await transaction
    .select({ id: schema.passkeys.id })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, session.user.id))
    .limit(minimumPasskeys);

  if (
    enrolled.length >= minimumPasskeys &&
    !(await hasRecentAdminVerification(transaction, session))
  ) {
    throw new APIError('FORBIDDEN', { code: 'PASSKEY_REQUIRED' });
  }
}

type PasskeyInteractionResult = {
  data: object;
  headers: Headers;
};

type VerificationRequest = {
  headers: Headers;
  session: AuthorizedSession;
  response: AuthenticationResponse;
};

async function verifyAdministrator(
  database: Pick<Database, 'select' | 'update' | 'delete'>,
  auth: Auth,
  request: VerificationRequest,
): Promise<PasskeyInteractionResult> {
  const { headers, session, response } = request;
  const activeSessions = await database
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, session.session.id),
        gt(schema.sessions.expiresAt, new Date()),
        isNull(schema.sessions.deletedAt),
      ),
    )
    .for('update');

  if (!activeSessions.at(firstRow)) {
    throw new APIError('UNAUTHORIZED');
  }

  const verified = await auth.api.verifyPasskeyAuthentication({
    headers,
    body: { response },
    returnHeaders: true,
  });

  if (verified.response.user.id !== session.user.id) {
    throw new APIError('UNAUTHORIZED');
  }

  const passkeys = await database
    .select({ id: schema.passkeys.id })
    .from(schema.passkeys)
    .where(
      and(
        eq(schema.passkeys.credentialID, response.id),
        eq(schema.passkeys.userId, session.user.id),
      ),
    );
  const matched = passkeys.at(firstRow);
  if (!matched) {
    throw new APIError('UNAUTHORIZED');
  }

  await database
    .update(schema.sessions)
    .set({
      adminPasskeyId: matched.id,
      adminVerifiedAt: new Date(),
    })
    .where(eq(schema.sessions.id, verified.response.session.id));
  await database.delete(schema.sessions).where(eq(schema.sessions.id, session.session.id));
  return {
    data: { verified: true },
    headers: verified.headers,
  };
}

export async function runAdminPasskeyAction(
  database: PasskeyDatabase,
  options: AuthOptions,
  headers: Headers,
  action: AdminPasskeyAction,
): Promise<PasskeyInteractionResult> {
  return database.transaction(async (transaction) => {
    const auth = createAuth(transaction, options);
    return withAuthAdapter(auth, async () => {
      const session = await auth.api.getSession({ headers });
      if (!session?.user.emailVerified) {
        throw new APIError('UNAUTHORIZED');
      }

      if (action.action === 'begin-enrollment' || action.action === 'finish-enrollment') {
        await protectPasskeyEnrollment(transaction, session);
      }

      if (action.action === 'begin-enrollment') {
        await auth.api.verifyPassword({
          headers,
          body: { password: action.password },
        });
        const start = await auth.api.generatePasskeyRegistrationOptions({
          headers,
          query: { context: session.session.id },
          returnHeaders: true,
        });
        return {
          data: start.response,
          headers: start.headers,
        };
      }

      if (action.action === 'finish-enrollment') {
        const registered = await auth.api.verifyPasskeyRegistration({
          headers,
          body: { response: action.response },
          returnHeaders: true,
        });
        return {
          data: { enrolled: true },
          headers: registered.headers,
        };
      }

      if (action.action === 'begin-verification') {
        const start = await auth.api.generatePasskeyAuthenticationOptions({
          headers,
          returnHeaders: true,
        });
        return {
          data: start.response,
          headers: start.headers,
        };
      }

      return verifyAdministrator(transaction, auth, {
        headers,
        session,
        response: action.response,
      });
    });
  });
}
