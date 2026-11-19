import type { OAuthOptions, Scope } from '@better-auth/oauth-provider';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { useDatabase } from '../database/index.ts';
import { appGrants, appInstallations } from '../database/schema.ts';
import { createAuth } from '../utils/auth.ts';
import { CONSOLE_CLIENT_ID } from './authorization.service.ts';

export type ClientRegistration = {
  name: string;
  redirectUris: readonly string[];
} & (
  | { kind: 'console' }
  | {
      kind: 'installation';
      organizationId: string;
      rolePermissions?: Readonly<Record<string, readonly string[]>>;
    }
);

type RegistrationDatabase = Omit<ReturnType<typeof useDatabase>, '$client'>;

type Assignment = { organizationId: string; clientId: string; userId: string };

type RegistrationPolicy = Pick<
  OAuthOptions<Scope[]>,
  'clientPrivileges' | 'generateClientId' | 'clientReference'
>;

const FIRST_ASSIGNMENT = 0;
const MIN_CALLBACKS = 1;

/**
 * Restricts managed client creation to an internal provisioning instance.
 *
 * @param {ClientRegistration} [registration] - The registration authorized by trusted provisioning code.
 * @returns {RegistrationPolicy} Better Auth client registration hooks.
 */
export function createRegistrationPolicy(registration?: ClientRegistration): RegistrationPolicy {
  if (!registration) {
    return { clientPrivileges: () => false };
  }

  return {
    generateClientId: () => (registration.kind === 'console' ? CONSOLE_CLIENT_ID : randomUUID()),
    clientPrivileges: ({ action, user }) => action === 'create' && user?.emailVerified === true,
    clientReference: () =>
      registration.kind === 'installation' ? registration.organizationId : CONSOLE_CLIENT_ID,
  };
}

/**
 * Registers a confidential web client through Better Auth. Call from trusted provisioning
 * code with a verified account session. The client and installation commit together.
 * The returned secret is available only at registration.
 *
 * @param {Headers} headers - Headers carrying the verified provisioning session.
 * @param {ClientRegistration} registration - Registration type, name, organization, and exact callbacks.
 * @param {RegistrationDatabase} database - Connection or transaction that owns the registration.
 * @returns {Promise<{clientId: string, clientSecret: string}>} Credentials for the app backend.
 */
export async function provisionClient(
  headers: Headers,
  registration: ClientRegistration,
  database: RegistrationDatabase = useDatabase(),
): Promise<{ clientId: string; clientSecret: string }> {
  const name = registration.name.trim();
  const redirectUris = [...new Set(registration.redirectUris)];

  if (
    !name ||
    redirectUris.length < MIN_CALLBACKS ||
    redirectUris.some((callback) => !callback.startsWith('https://') || callback.includes('*'))
  ) {
    throw new Error('Supply an application name and exact HTTPS callback URLs.');
  }

  return database.transaction(async (transaction) => {
    const auth = createAuth(transaction, { registration });
    const client = await auth.api.adminCreateOAuthClient({
      headers,
      body: {
        redirect_uris: redirectUris,
        scope: registration.kind === 'console' ? 'openid email profile' : 'openid',
        ...(registration.kind === 'installation' && {
          metadata: { rolePermissions: registration.rolePermissions ?? {} },
        }),
        client_name: name,
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        require_pkce: true,
        skip_consent: registration.kind === 'console',
      },
    });

    if (!client.client_secret) {
      throw new Error('The provider did not issue a confidential client credential.');
    }

    if (registration.kind === 'installation') {
      await transaction.insert(appInstallations).values({
        clientId: client.client_id,
        organizationId: registration.organizationId,
      });
    }

    return {
      clientId: client.client_id,
      clientSecret: client.client_secret,
    };
  });
}

/**
 * Assigns a member's role for one installation. A role change invalidates previous consent
 * and outstanding codes. Repeating the same assignment preserves both.
 *
 * @param {Assignment & {role: string}} input - Organization, client, member, and app role.
 * @param {RegistrationDatabase} database - Connection or transaction that owns the assignment.
 */
export async function assignAppRole(
  input: Assignment & { role: string },
  database: RegistrationDatabase = useDatabase(),
): Promise<void> {
  const role = input.role.trim();
  const assignments = await database
    .insert(appGrants)
    .values({ ...input, role })
    .onConflictDoUpdate({
      target: [appGrants.clientId, appGrants.userId],
      set: {
        role,
        revision: sql`CASE WHEN ${appGrants.role} = ${role} THEN ${appGrants.revision} ELSE gen_random_uuid() END`,
      },
      setWhere: eq(appGrants.organizationId, input.organizationId),
    })
    .returning({ id: appGrants.id });

  if (!assignments.at(FIRST_ASSIGNMENT)) {
    throw new Error('The installation belongs to another organization.');
  }
}

/**
 * Revokes a member's app assignment in the specified organization.
 *
 * @param {Assignment} input - Organization, client, and member identifiers.
 * @param {RegistrationDatabase} database - Connection or transaction that owns the revocation.
 */
export async function revokeAppGrant(
  input: Assignment,
  database: RegistrationDatabase = useDatabase(),
): Promise<void> {
  await database
    .delete(appGrants)
    .where(
      and(
        eq(appGrants.organizationId, input.organizationId),
        eq(appGrants.clientId, input.clientId),
        eq(appGrants.userId, input.userId),
      ),
    );
}
