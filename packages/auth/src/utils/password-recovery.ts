import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { Auth, AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import * as valibot from 'valibot';
import {
  passwordRecoveryCooldownSeconds,
  reservePasswordRecoveryEmail,
} from './account-email-rate.ts';
import { accountCodeSchema } from './account-otp.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'insert' | 'select'>;
type SendRecoveryMail = NonNullable<AuthOptions['sendPasswordRecoveryEmail']>;
type RecoveryAccount = { id: string; email: string };

const endpointPath = '/account/password-recovery';
const rateMaximum = 10;
const maxEmailLength = 254;
const minPasswordLength = 12;
const maxPasswordLength = 128;
const firstRow = 0;
const emailSchema = valibot.pipe(
  valibot.string('Enter an email address.'),
  valibot.trim(),
  valibot.maxLength(maxEmailLength, 'The email address is too long.'),
  valibot.email('Enter a valid email address.'),
  valibot.toLowerCase(),
);
const passwordSchema = valibot.pipe(
  valibot.string('Enter a new password.'),
  valibot.minLength(minPasswordLength, 'Use at least 12 characters.'),
  valibot.maxLength(maxPasswordLength, 'Use at most 128 characters.'),
);
const recoverySchema = valibot.variant('action', [
  valibot.strictObject({
    action: valibot.literal('request'),
    email: emailSchema,
  }),
  valibot.strictObject({
    action: valibot.literal('reset'),
    email: emailSchema,
    code: accountCodeSchema,
    password: passwordSchema,
  }),
]);

async function findRecoveryAccount(
  database: Database,
  email: string,
): Promise<RecoveryAccount | null> {
  const { users, accounts } = schema;
  const candidates = await database
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(
      and(
        eq(users.email, email),
        isNull(users.deletedAt),
        eq(accounts.providerId, 'credential'),
        isNotNull(accounts.password),
      ),
    );

  return candidates.at(firstRow) ?? null;
}

type RecoveryRequest = {
  email: string;
  sendMail: SendRecoveryMail;
};

async function sendRecoveryCode(
  database: Database,
  auth: Auth,
  request: RecoveryRequest,
): Promise<void> {
  try {
    const account = await findRecoveryAccount(database, request.email);
    if (!account || !(await reservePasswordRecoveryEmail(database, account.id))) {
      return;
    }

    const otp = await auth.api.createVerificationOTP({
      body: {
        email: account.email,
        type: 'forget-password',
      },
    });
    await request.sendMail({
      email: account.email,
      otp,
    });
  } catch {
    console.warn('AUTH_PASSWORD_RECOVERY_DELIVERY_FAILED');
  }
}

export function passwordRecovery(
  database: Database,
  options: AuthOptions,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'iam-password-recovery',
    rateLimit: [
      {
        pathMatcher: (path) => path === endpointPath,
        window: passwordRecoveryCooldownSeconds,
        max: rateMaximum,
      },
    ],
    endpoints: {
      passwordRecovery: createAuthEndpoint(
        endpointPath,
        {
          method: 'POST',
          body: recoverySchema,
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

          if (!options.sendPasswordRecoveryEmail) {
            throw new APIError('SERVICE_UNAVAILABLE');
          }

          const auth = useAuth();
          const { body } = context;

          if (body.action === 'request') {
            context.context.runInBackground(
              sendRecoveryCode(database, auth, {
                email: body.email,
                sendMail: options.sendPasswordRecoveryEmail,
              }),
            );
            return context.json({ accepted: true });
          }

          try {
            await auth.api.checkVerificationOTP({
              body: {
                email: body.email,
                type: 'forget-password',
                otp: body.code,
              },
            });
            const account = await findRecoveryAccount(database, body.email);
            if (!account) {
              throw new APIError('BAD_REQUEST');
            }

            await auth.api.resetPasswordEmailOTP({
              body: {
                email: account.email,
                otp: body.code,
                password: body.password,
              },
            });
            console.info('AUTH_PASSWORD_RECOVERY_COMPLETED', { userId: account.id });
          } catch (error) {
            if (
              error instanceof APIError &&
              (error.status === 'BAD_REQUEST' || error.status === 'FORBIDDEN')
            ) {
              throw new APIError('BAD_REQUEST', { code: 'RECOVERY_CODE_INVALID' });
            }

            throw error;
          }

          return context.json({ reset: true });
        },
      ),
    },
  };
}
