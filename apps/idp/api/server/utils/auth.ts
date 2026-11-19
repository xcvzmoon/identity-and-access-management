import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { organization } from 'better-auth/plugins/organization';
import { useDatabase } from '../database/index.ts';
import * as schema from '../database/schema.ts';
import { useEnv } from './env.ts';
import { sendAccountEmail } from './mail.ts';

type Auth = ReturnType<typeof createAuth>;

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

// Better Auth infers the organization endpoints from the configured plugins.
// oxlint-disable-next-line typescript/explicit-function-return-type
function createAuth() {
  const env = useEnv();
  const database = useDatabase();

  return betterAuth({
    baseURL: env.oidcIssuerUrl,
    basePath: '/api/v1/auth',
    secret: env.betterAuthSecret,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema,
      usePlural: true,
      transaction: true,
    }),
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        schema: { member: { modelName: 'membership' } },
        async sendInvitationEmail(invitation) {
          const url = new URL('/invite', env.oidcIssuerUrl);
          url.hash = new URLSearchParams({ token: invitation.id }).toString();
          await sendAccountEmail(invitation.email, 'Join your organization', url.href);
        },
      }),
    ],
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ['x-iam-peer-ip'] },
    },
    verification: { storeIdentifier: 'hashed' },
    logger: { disabled: true },
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAccountEmail(user.email, 'Verify your email address', url);
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAccountEmail(user.email, 'Reset your password', url);
      },
    },
  });
}

let auth: Auth | null = null;

export function useAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
