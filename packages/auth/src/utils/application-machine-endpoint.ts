import type { useDatabase } from '@iam/database';
import type { BetterAuthPlugin } from 'better-auth';
import type { Auth } from './auth.ts';
import { apiKey } from '@better-auth/api-key';
import { schema } from '@iam/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

export const applicationKeyConfiguration = 'application-machine';
const applicationKeyPrefix = 'iam_app_';
const applicationKeyLength = 64;
const firstRow = 0;
const expirationSeconds = 604_800;
const keyRateWindowMs = 60_000;
const keyRateMaximum = 60;
const networkRateWindowSeconds = 60;
const networkRateMaximum = 120;
const installationPermission = { installation: ['read'] };

type KeyDatabase = Pick<ReturnType<typeof useDatabase>, 'select'>;

export function applicationApiKeys(): ReturnType<typeof apiKey> {
  return apiKey(
    {
      configId: applicationKeyConfiguration,
      references: 'organization',
      defaultPrefix: applicationKeyPrefix,
      defaultKeyLength: applicationKeyLength,
      enableSessionForAPIKeys: false,
      startingCharactersConfig: { shouldStore: false },
      keyExpiration: {
        defaultExpiresIn: expirationSeconds,
        disableCustomExpiresTime: true,
      },
      rateLimit: {
        enabled: true,
        timeWindow: keyRateWindowMs,
        maxRequests: keyRateMaximum,
      },
      permissions: { defaultPermissions: installationPermission },
    },
    { schema: { apikey: { modelName: 'apiKey' } } },
  );
}

function isApplicationKey(key: string | null): key is string {
  return Boolean(
    key?.startsWith(applicationKeyPrefix) &&
    key.length === applicationKeyPrefix.length + applicationKeyLength &&
    /^[A-Za-z]+$/u.test(key.slice(applicationKeyPrefix.length)),
  );
}

export function applicationMachineEndpoint(
  database: KeyDatabase,
  useAuth: () => Auth,
): BetterAuthPlugin {
  return {
    id: 'application-machine',
    rateLimit: [
      {
        pathMatcher: (path) => path === '/machine/installation',
        window: networkRateWindowSeconds,
        max: networkRateMaximum,
      },
    ],
    endpoints: {
      getMachineInstallation: createAuthEndpoint(
        '/machine/installation',
        { method: 'GET' },
        async (context) => {
          const headers = context.headers;
          const key = headers?.get('x-api-key') ?? null;
          if (
            !isApplicationKey(key) ||
            headers?.has('origin') ||
            headers?.has('cookie') ||
            headers?.has('authorization')
          ) {
            throw new APIError('UNAUTHORIZED');
          }

          const verified = await useAuth().api.verifyApiKey({
            body: {
              configId: applicationKeyConfiguration,
              key,
              permissions: installationPermission,
            },
          });

          if (!verified.valid || !verified.key) {
            if (verified.error?.code === 'RATE_LIMITED') {
              throw new APIError('TOO_MANY_REQUESTS');
            }

            throw new APIError('UNAUTHORIZED');
          }

          const installations = await database
            .select({
              principalId: schema.appMachinePrincipals.id,
              installationId: schema.appInstallations.id,
              applicationId: schema.applications.id,
            })
            .from(schema.appMachineKeys)
            .innerJoin(schema.apiKeys, eq(schema.apiKeys.id, schema.appMachineKeys.keyId))
            .innerJoin(
              schema.appMachinePrincipals,
              eq(schema.appMachinePrincipals.id, schema.appMachineKeys.principalId),
            )
            .innerJoin(
              schema.appInstallations,
              eq(schema.appInstallations.id, schema.appMachinePrincipals.installationId),
            )
            .innerJoin(
              schema.applications,
              eq(schema.applications.id, schema.appInstallations.applicationId),
            )
            .innerJoin(
              schema.organizations,
              eq(schema.organizations.id, schema.appInstallations.organizationId),
            )
            .where(
              and(
                eq(schema.apiKeys.id, verified.key.id),
                eq(schema.apiKeys.configId, applicationKeyConfiguration),
                eq(schema.apiKeys.referenceId, verified.key.referenceId),
                eq(schema.apiKeys.referenceId, schema.organizations.id),
                eq(schema.apiKeys.enabled, true),
                gt(schema.apiKeys.expiresAt, sql`now()`),
                isNull(schema.organizations.disabledAt),
                isNull(schema.applications.deletedAt),
                isNull(schema.appInstallations.deletedAt),
              ),
            );
          const installation = installations.at(firstRow);
          if (!installation) {
            throw new APIError('UNAUTHORIZED');
          }

          return context.json({
            ...installation,
            status: 'active',
          });
        },
      ),
    },
  };
}
