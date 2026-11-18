import type { useDatabase } from '@iam/database';
import type { BetterAuthOptions } from 'better-auth';
import type { AccountCodeMailer } from './account-email.ts';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { schema } from '@iam/database';
import { betterAuth } from 'better-auth';
import { accountCodes } from './account-otp.ts';
import { passwordRecovery } from './password-recovery.ts';

type AuthConfiguration = BetterAuthOptions & {
  plugins: [ReturnType<typeof accountCodes>, ReturnType<typeof passwordRecovery>];
};

export type Auth = ReturnType<typeof betterAuth<AuthConfiguration>>;

type AuthDatabase = Pick<
  ReturnType<typeof useDatabase>,
  'insert' | 'select' | 'selectDistinct' | 'transaction' | 'query'
>;

export type AuthOptions = {
  secret: string;
  url: string;
  webOrigin: string;
  sendPasswordRecoveryEmail?: AccountCodeMailer;
};

function logAuthEvent(level: string): void {
  if (level === 'error') {
    console.error('AUTH_ERROR');
  } else if (level === 'warn') {
    console.warn('AUTH_WARNING');
  }
}

export function createAuth(database: AuthDatabase, options: AuthOptions): Auth {
  const auth: Auth = betterAuth<AuthConfiguration>({
    appName: 'Identity and Access Management',
    logger: { log: logAuthEvent },
    secret: options.secret,
    baseURL: options.url,
    trustedOrigins: [options.webOrigin],
    database: drizzleAdapter(database, {
      provider: 'pg',
      schemaName: 'iam',
      usePlural: true,
      transaction: true,
      schema,
    }),
    plugins: [accountCodes(options), passwordRecovery(database, options, () => auth)],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
  });

  return auth;
}
