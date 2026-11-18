import type { useDatabase } from '@iam/database';
import type { AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError } from 'better-auth/api';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { applicationCallbackSchema } from './application-callback.ts';
import { withAuthAdapter } from './auth-adapter-scope.ts';
import { createAuth } from './auth.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'transaction'>;
type ClientReader = Pick<ReturnType<typeof useDatabase>, 'select'>;
type ClientOptions = Pick<AuthOptions, 'secret' | 'url' | 'webOrigin'>;
type ClientTransaction = Pick<ReturnType<typeof useDatabase>, 'update' | 'insert'>;
type ClientChangeResult =
  | { action: 'disable' }
  | { action: 'rotate-secret'; clientSecret: string; credentialVersion: string }
  | { action: 'replace-callback'; redirectUri: string; credentialVersion: string };
type ManagedClient = {
  installationId: string;
  organizationId: string;
  credentialVersion: string;
  disabled: boolean | null;
  redirectUris: string[];
};

const firstRow = 0;
const singleCallback = 1;
const maximumClientIdLength = 256;
export const applicationClientIdSchema = valibot.pipe(
  valibot.string(),
  valibot.nonEmpty(),
  valibot.maxLength(maximumClientIdLength),
);
const versionSchema = valibot.pipe(valibot.string(), valibot.uuid());
const clientChangeSchema = valibot.variant('action', [
  valibot.object({
    clientId: applicationClientIdSchema,
    action: valibot.picklist(['disable', 'rotate-secret']),
    expectedVersion: valibot.optional(versionSchema),
  }),
  valibot.strictObject({
    clientId: applicationClientIdSchema,
    action: valibot.literal('replace-callback'),
    expectedVersion: versionSchema,
    redirectUri: applicationCallbackSchema,
  }),
]);
export type ClientChange = valibot.InferInput<typeof clientChangeSchema>;

async function findManagedClient(
  transaction: ClientReader,
  clientId: string,
): Promise<ManagedClient | null> {
  const clients = await transaction
    .select({
      installationId: schema.appClients.installationId,
      organizationId: schema.appInstallations.organizationId,
      credentialVersion: schema.appClients.credentialVersion,
      disabled: schema.oauthClients.disabled,
      redirectUris: schema.oauthClients.redirectUris,
    })
    .from(schema.appClients)
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.clientId, schema.appClients.clientId))
    .innerJoin(
      schema.appInstallations,
      eq(schema.appInstallations.id, schema.appClients.installationId),
    )
    .innerJoin(
      schema.applications,
      eq(schema.applications.id, schema.appInstallations.applicationId),
    )
    .where(
      and(
        eq(schema.appClients.clientId, clientId),
        isNull(schema.appClients.deletedAt),
        isNull(schema.appInstallations.deletedAt),
        isNull(schema.applications.deletedAt),
      ),
    )
    .for('update');

  return clients.at(firstRow) ?? null;
}

async function advanceCredentialVersion(
  transaction: ClientTransaction,
  clientId: string,
): Promise<string> {
  const [{ credentialVersion }] = await transaction
    .update(schema.appClients)
    .set({ credentialVersion: sql`gen_random_uuid()` })
    .where(eq(schema.appClients.clientId, clientId))
    .returning({ credentialVersion: schema.appClients.credentialVersion });

  return credentialVersion;
}

async function applyClientChange(
  transaction: ClientTransaction,
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  change: ClientChange,
): Promise<ClientChangeResult> {
  const { clientId, action } = change;

  if (action === 'rotate-secret') {
    const rotated = await auth.api.rotateClientSecret({
      headers,
      body: { client_id: clientId },
    });

    if (!rotated.client_secret) {
      throw new Error('Confidential OAuth client credential was not issued');
    }

    return {
      action,
      clientSecret: rotated.client_secret,
      credentialVersion: await advanceCredentialVersion(transaction, clientId),
    };
  }

  const redirectUri = change.action === 'replace-callback' ? change.redirectUri : null;
  await auth.api.adminUpdateOAuthClient({
    headers,
    body: {
      client_id: clientId,
      update: redirectUri === null ? { disabled: true } : { redirect_uris: [redirectUri] },
    },
  });
  return redirectUri === null
    ? { action: 'disable' }
    : {
        action: 'replace-callback',
        redirectUri,
        credentialVersion: await advanceCredentialVersion(transaction, clientId),
      };
}

const auditActions = {
  disable: 'client.disabled',
  'rotate-secret': 'client.secret_rotated',
  'replace-callback': 'client.callback_replaced',
} satisfies Record<ClientChange['action'], string>;

/**
 * Disables a registered OAuth client, rotates its secret, or replaces its callback URL.
 * Call from a trusted server after checking recent MFA. Changes revoke issued
 * access tokens and write an audit event without storing the plaintext secret.
 * @param {Database} database - Shared IAM database.
 * @param {ClientOptions} options - Issuer and auth configuration.
 * @param {Headers} headers - Request headers containing the organization administrator's session.
 * @param {ClientChange} change - Target client and operation.
 * @returns {Promise<ClientChangeResult>} Completed operation and the new secret for rotation.
 * @throws {APIError} The session or organization privilege is invalid, or the provider rejects the change.
 */
export async function manageApplicationClient(
  database: Database,
  options: ClientOptions,
  headers: Headers,
  change: ClientChange,
): Promise<ClientChangeResult> {
  const parsed = valibot.safeParse(clientChangeSchema, change);
  if (!parsed.success) {
    throw new APIError('BAD_REQUEST', { message: 'Invalid client operation' });
  }

  const { clientId, action, expectedVersion } = parsed.output;
  return database.transaction(async (transaction) => {
    const currentAuth = createAuth(transaction, options);
    const session = await withAuthAdapter(currentAuth, async () =>
      currentAuth.api.getSession({ headers }),
    );

    if (!session) {
      throw new APIError('UNAUTHORIZED');
    }

    const actorId = session.user.id;
    const target = await findManagedClient(transaction, clientId);
    if (!target || !(await lockOrganizationAdmin(transaction, target.organizationId, actorId))) {
      throw new APIError('UNAUTHORIZED');
    }

    if (
      expectedVersion &&
      (target.disabled !== false || target.credentialVersion !== expectedVersion)
    ) {
      throw new APIError('CONFLICT', { code: 'CLIENT_CREDENTIAL_CHANGED' });
    }

    if (
      parsed.output.action === 'replace-callback' &&
      target.redirectUris.length === singleCallback &&
      target.redirectUris.at(firstRow) === parsed.output.redirectUri
    ) {
      return {
        action: parsed.output.action,
        redirectUri: parsed.output.redirectUri,
        credentialVersion: target.credentialVersion,
      };
    }

    const auth = createAuth(transaction, {
      ...options,
      registration: {
        clientReference: () => target.organizationId,
        clientPrivileges: (context) =>
          context.user?.id === actorId &&
          context.clientId === clientId &&
          context.action === (action === 'rotate-secret' ? 'rotate' : 'update'),
      },
    });

    return withAuthAdapter(auth, async () => {
      const result = await applyClientChange(transaction, auth, headers, parsed.output);
      await transaction
        .update(schema.oauthAccessTokens)
        .set({ revoked: new Date() })
        .where(
          and(
            eq(schema.oauthAccessTokens.clientId, clientId),
            isNull(schema.oauthAccessTokens.revoked),
          ),
        );
      await transaction.insert(schema.appAccessEvents).values({
        actorId,
        installationId: target.installationId,
        action: auditActions[action],
        details: { clientId },
      });
      return result;
    });
  });
}
