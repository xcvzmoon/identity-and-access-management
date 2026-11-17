import type { useDatabase } from '@iam/database';
import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { schema } from '@iam/database';
import { betterAuth } from 'better-auth';

export type Auth = ReturnType<typeof betterAuth>;

type AuthOptions = {
  secret: string;
  url: string;
  webOrigin: string;
};

function logAuthEvent(level: string): void {
  if (level === 'error') {
    console.error('AUTH_ERROR');
  } else if (level === 'warn') {
    console.warn('AUTH_WARNING');
  }
}

export function createAuth(database: ReturnType<typeof useDatabase>, options: AuthOptions): Auth {
  return betterAuth<BetterAuthOptions>({
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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
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
}
