import type { ClientRegistration } from '../services/registration.service.ts';
import { oauthProvider } from '@better-auth/oauth-provider';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { jwt } from 'better-auth/plugins/jwt';
import { organization } from 'better-auth/plugins/organization';
import { useDatabase } from '../database/index.ts';
import * as schema from '../database/schema.ts';
import {
  authorizationPolicy,
  recordIssuedAuthorization,
} from '../services/authorization.service.ts';
import { createRegistrationPolicy } from '../services/registration.service.ts';
import { persistInitialKey, readSigningKeys } from '../services/signing-key.service.ts';
import { useEnv } from './env.ts';
import { sendAccountEmail } from './mail.ts';

type AuthDatabase = Omit<ReturnType<typeof useDatabase>, '$client'>;
type AuthOptions = {
  registration?: ClientRegistration;
  beforeAcceptInvitation?: (userId: string) => Promise<void>;
};
type Auth = ReturnType<typeof configureAuth>;

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

async function sendInvitation(email: string, id: string): Promise<void> {
  const env = useEnv();
  const url = new URL('/invite', env.oidcIssuerUrl);

  url.hash = new URLSearchParams({ token: id }).toString();
  await sendAccountEmail(email, 'Join your organization', url.href, 'confirmed');
}

// Better Auth infers the organization endpoints from the configured plugins.
// oxlint-disable-next-line typescript/explicit-function-return-type
function configureAuth(database: AuthDatabase, options: AuthOptions) {
  const env = useEnv();

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
    databaseHooks: { verification: { create: { after: recordIssuedAuthorization } } },
    plugins: [
      passkey({
        rpID: new URL(env.oidcIssuerUrl).hostname,
        rpName: 'IAM',
        origin: env.oidcIssuerUrl,
        authenticatorSelection: { userVerification: 'required' },
      }),
      jwt({
        schema: { jwks: { modelName: 'signingKey' } },
        adapter: {
          getJwks: async () => readSigningKeys(database),
          createJwk: async (candidate) => persistInitialKey(database, candidate),
        },
        disableSettingJwtHeader: true,
        jwt: { issuer: env.oidcIssuerUrl },
        jwks: {
          keyPairConfig: { alg: 'RS256' },
          gracePeriod: Number.MAX_SAFE_INTEGER,
        },
      }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        scopes: ['openid', 'email', 'profile'],
        grantTypes: ['authorization_code'],
        allowDynamicClientRegistration: false,
        ...authorizationPolicy,
        ...createRegistrationPolicy(database, options.registration),
      }),
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        organizationHooks: {
          beforeAcceptInvitation: async ({ user }) => options.beforeAcceptInvitation?.(user.id),
        },
        schema: { member: { modelName: 'membership' } },
        sendInvitationEmail: async ({ email, id }) => sendInvitation(email, id),
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

/**
 * @param {AuthDatabase} database - IdP connection or transaction that owns the operation.
 * @param {AuthOptions} [options] - Scoped client registration or invitation acceptance hooks.
 * @returns {Auth} An issuer whose Better Auth writes use the supplied connection.
 */
export function createAuth(database: AuthDatabase, options: AuthOptions = {}): Auth {
  return configureAuth(database, options);
}

let auth: Auth | null = null;

export function useAuth(): Auth {
  if (auth === null) {
    const database = useDatabase();
    auth = createAuth(database);
  }

  return auth;
}
