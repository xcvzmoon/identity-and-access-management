import type { ClientRegistration } from '../services/registration.service.ts';
import { oauthProvider } from '@better-auth/oauth-provider';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { jwt } from 'better-auth/plugins/jwt';
import { organization } from 'better-auth/plugins/organization';
import { isNull } from 'drizzle-orm';
import { useDatabase } from '../database/index.ts';
import * as schema from '../database/schema.ts';
import {
  authorizationPolicy,
  recordIssuedAuthorization,
} from '../services/authorization.service.ts';
import { createRegistrationPolicy } from '../services/registration.service.ts';
import { useEnv } from './env.ts';
import { sendAccountEmail } from './mail.ts';

type AuthDatabase = Omit<ReturnType<typeof useDatabase>, '$client'>;
type Auth = ReturnType<typeof configureAuth>;

const FIRST_KEY_INDEX = 0;
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
function configureAuth(database: AuthDatabase, registration?: ClientRegistration) {
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
          async createJwk(candidate) {
            const keys = await database
              .insert(schema.signingKeys)
              .values({
                ...candidate,
                alg: 'RS256',
              })
              .onConflictDoUpdate({
                target: schema.signingKeys.alg,
                targetWhere: isNull(schema.signingKeys.expiresAt),
                set: { alg: 'RS256' },
              })
              .returning();
            const key = keys.at(FIRST_KEY_INDEX);
            if (!key) {
              throw new Error('The IdP signing key could not be persisted.');
            }

            return {
              id: key.id,
              publicKey: key.publicKey,
              privateKey: key.privateKey,
              createdAt: key.createdAt,
              alg: 'RS256',
            };
          },
        },
        disableSettingJwtHeader: true,
        jwt: { issuer: env.oidcIssuerUrl },
        jwks: { keyPairConfig: { alg: 'RS256' } },
      }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        scopes: ['openid', 'email', 'profile'],
        grantTypes: ['authorization_code'],
        allowDynamicClientRegistration: false,
        ...authorizationPolicy,
        ...createRegistrationPolicy(registration),
      }),
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
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
 * @param {ClientRegistration} [registration] - Enables one trusted client provisioning operation.
 * @returns {Auth} An issuer whose Better Auth writes use the supplied connection.
 */
export function createAuth(database: AuthDatabase, registration?: ClientRegistration): Auth {
  return configureAuth(database, registration);
}

let auth: Auth | null = null;

export function useAuth(): Auth {
  if (auth === null) {
    const database = useDatabase();
    auth = createAuth(database);
  }

  return auth;
}
