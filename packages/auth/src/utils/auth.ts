import type { useDatabase } from '@iam/database';
import type { BetterAuthOptions } from 'better-auth';
import type { Jwk } from 'better-auth/plugins';
import type { AccountCodeMailer, OrganizationInvitationMailer } from './account-email.ts';
import type { AccessLookup } from './oidc-token-responses.ts';
import type { ManagedRegistration } from './oidc.ts';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { readApplicationTokenAccess, resolveApplicationGrant, schema } from '@iam/database';
import { betterAuth } from 'better-auth';
import { jwt, organization } from 'better-auth/plugins';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { accountCodes } from './account-otp.ts';
import { adminAccess } from './admin-access.ts';
import { adminInteraction } from './admin-interaction.ts';
import { administratorPasskeys } from './admin-passkeys.ts';
import { applicationApiKeys, applicationMachineEndpoint } from './application-machine-endpoint.ts';
import { applicationTokenResponses } from './oidc-token-responses.ts';
import { createApplicationOidcProvider } from './oidc.ts';
import { organizationInvitations } from './organization-invitations.ts';
import { organizationMembership } from './organization-membership.ts';
import { organizationOwnership } from './organization-ownership.ts';
import { passwordRecovery } from './password-recovery.ts';
import {
  issuerSigningAlgorithm,
  lockSigningKeys,
  signingKeyGraceSeconds,
} from './signing-key-policy.ts';

const signingKeyLimit = 1;
const firstRow = 0;

type AuthConfiguration = BetterAuthOptions & {
  plugins: [
    ReturnType<typeof organization>,
    ReturnType<typeof jwt>,
    ReturnType<typeof createApplicationOidcProvider>,
    ReturnType<typeof applicationTokenResponses>,
    ReturnType<typeof applicationApiKeys>,
    ReturnType<typeof applicationMachineEndpoint>,
    ReturnType<typeof administratorPasskeys>,
    ReturnType<typeof adminInteraction>,
    ReturnType<typeof adminAccess>,
    ReturnType<typeof accountCodes>,
    ReturnType<typeof passwordRecovery>,
    ReturnType<typeof organizationInvitations>,
    ReturnType<typeof organizationMembership>,
    ReturnType<typeof organizationOwnership>,
  ];
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
  idpOrigin?: string;
  registration?: ManagedRegistration;
  sendPasswordRecoveryEmail?: AccountCodeMailer;
  sendOrganizationInvitation?: OrganizationInvitationMailer;
};

function logAuthEvent(level: string): void {
  if (level === 'error') {
    console.error('AUTH_ERROR');
  } else if (level === 'warn') {
    console.warn('AUTH_WARNING');
  }
}

/**
 * Reuses a signing key created by another request while Better Auth generated
 * its candidate. PostgreSQL holds the lock through the commit across replicas.
 * @param {AuthDatabase} database - The connection that stores issuer keys.
 * @param {Omit<Jwk, 'id'>} candidate - The key pair with its private key encrypted by Better Auth.
 * @returns {Promise<Jwk>} The persisted key used for signing.
 */
async function persistSigningKey(database: AuthDatabase, candidate: Omit<Jwk, 'id'>): Promise<Jwk> {
  const { jwks } = schema;
  const algorithm = candidate.alg ?? issuerSigningAlgorithm;
  return database.transaction(
    async (transaction) => {
      await transaction.execute(lockSigningKeys);
      const keys = await transaction
        .select({
          id: jwks.id,
          publicKey: jwks.publicKey,
          privateKey: jwks.privateKey,
          createdAt: jwks.createdAt,
          expiresAt: jwks.expiresAt,
        })
        .from(jwks)
        .where(
          and(
            eq(jwks.alg, algorithm),
            or(isNull(jwks.expiresAt), gt(jwks.expiresAt, sql`clock_timestamp()`)),
          ),
        )
        .orderBy(desc(jwks.createdAt))
        .limit(signingKeyLimit);
      const existing = keys.at(firstRow);
      if (existing) {
        const { expiresAt, ...key } = existing;
        const signingKey: Jwk = {
          ...key,
          alg: algorithm,
        };

        if (expiresAt) {
          signingKey.expiresAt = expiresAt;
        }

        return signingKey;
      }

      const [{ id }] = await transaction.insert(jwks).values(candidate).returning({ id: jwks.id });
      return { ...candidate, id };
    },
    { isolationLevel: 'read committed' },
  );
}

export function createAuth(database: AuthDatabase, options: AuthOptions): Auth {
  const readTokenAccess: AccessLookup = async (clientId, userId, sessionId) =>
    readApplicationTokenAccess(database, clientId, userId, sessionId);
  const idpOrigin = options.idpOrigin ?? options.webOrigin;
  const auth: Auth = betterAuth<AuthConfiguration>({
    appName: 'Identity and Access Management',
    logger: { log: logAuthEvent },
    secret: options.secret,
    baseURL: options.url,
    trustedOrigins: [...new Set([options.webOrigin, idpOrigin])],
    database: drizzleAdapter(database, {
      provider: 'pg',
      schemaName: 'iam',
      usePlural: true,
      transaction: true,
      schema,
    }),
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: true,
      }),
      jwt({
        disableSettingJwtHeader: true,
        jwt: { issuer: options.url },
        jwks: {
          keyPairConfig: { alg: issuerSigningAlgorithm },
          gracePeriod: signingKeyGraceSeconds,
        },
        adapter: { createJwk: async (candidate) => persistSigningKey(database, candidate) },
        schema: { jwks: { modelName: 'jwk' } },
      }),
      createApplicationOidcProvider(
        new URL('/oidc/login', idpOrigin).href,
        new URL('/oidc/consent', idpOrigin).href,
        {
          resolveAccess: async (clientId, userId, redirectUri) =>
            resolveApplicationGrant(database, clientId, userId, redirectUri),
          readTokenAccess,
        },
        options.registration,
      ),
      applicationTokenResponses(readTokenAccess),
      applicationApiKeys(),
      applicationMachineEndpoint(database, () => auth),
      administratorPasskeys(options.webOrigin),
      adminInteraction(database, options, () => auth),
      adminAccess(database, options, () => auth),
      accountCodes(options),
      passwordRecovery(database, options, () => auth),
      organizationInvitations(database, options, () => auth),
      organizationMembership(database, options, () => auth),
      organizationOwnership(database, options, () => auth),
    ],
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
