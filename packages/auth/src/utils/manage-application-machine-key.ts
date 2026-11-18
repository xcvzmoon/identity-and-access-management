import type { useDatabase } from '@iam/database';
import type { AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError } from 'better-auth/api';
import { and, eq, isNull } from 'drizzle-orm';
import * as valibot from 'valibot';
import { applicationKeyConfiguration } from './application-machine-endpoint.ts';
import { withAuthAdapter } from './auth-adapter-scope.ts';
import { createAuth } from './auth.ts';
import { readCurrentMachineKey } from './current-machine-key.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'transaction'>;
type Transaction = Pick<ReturnType<typeof useDatabase>, 'select' | 'insert' | 'update'>;
type MachineKeyOptions = Pick<AuthOptions, 'secret' | 'url' | 'webOrigin'>;
type MachineKeyResult =
  | { action: 'revoke' }
  | { action: 'issue' | 'rotate'; keyId: string; key: string; expiresAt: Date };

const firstRow = 0;
const uuidSchema = valibot.pipe(valibot.string(), valibot.uuid());
const machineKeyChangeSchema = valibot.variant('action', [
  valibot.object({
    action: valibot.literal('issue'),
    installationId: uuidSchema,
  }),
  valibot.object({
    action: valibot.picklist(['rotate', 'revoke']),
    installationId: uuidSchema,
    keyId: uuidSchema,
  }),
]);

type MachineKeyChange = valibot.InferInput<typeof machineKeyChangeSchema>;

async function lockInstallationOrganization(
  transaction: Transaction,
  installationId: string,
): Promise<string | null> {
  const installations = await transaction
    .select({ organizationId: schema.appInstallations.organizationId })
    .from(schema.appInstallations)
    .innerJoin(
      schema.applications,
      eq(schema.applications.id, schema.appInstallations.applicationId),
    )
    .where(
      and(
        eq(schema.appInstallations.id, installationId),
        isNull(schema.applications.deletedAt),
        isNull(schema.appInstallations.deletedAt),
      ),
    )
    .for('update');

  return installations.at(firstRow)?.organizationId ?? null;
}

async function disableKey(transaction: Transaction, keyId: string): Promise<void> {
  await transaction
    .update(schema.apiKeys)
    .set({
      enabled: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.apiKeys.id, keyId));
}

/**
 * Issues, replaces, or revokes the installation's machine key.
 * Call from a trusted server after checking recent MFA. Only a verified,
 * active owner can manage the key. Rotation disables the old key on commit.
 * @param {Database} database - Shared IAM database.
 * @param {MachineKeyOptions} options - Issuer and auth configuration.
 * @param {Headers} headers - Request headers containing the owner's IAM session.
 * @param {MachineKeyChange} change - Installation, operation, and current key ID when required.
 * @returns {Promise<MachineKeyResult>} Operation result and one-time credential for issue or rotation.
 * @throws {APIError} Invalid input, insufficient authority, or a conflict with the current key.
 */
export async function manageApplicationMachineKey(
  database: Database,
  options: MachineKeyOptions,
  headers: Headers,
  change: MachineKeyChange,
): Promise<MachineKeyResult> {
  const parsed = valibot.safeParse(machineKeyChangeSchema, change);
  if (!parsed.success) {
    throw new APIError('BAD_REQUEST', { message: 'Invalid machine key operation' });
  }

  const { installationId, action } = parsed.output;
  return database.transaction(async (transaction) => {
    const auth = createAuth(transaction, options);
    return withAuthAdapter(auth, async () => {
      const session = await auth.api.getSession({ headers });
      if (!session) {
        throw new APIError('UNAUTHORIZED');
      }

      const actorId = session.user.id;
      const organizationId = await lockInstallationOrganization(transaction, installationId);
      if (
        !organizationId ||
        !(await lockOrganizationAdmin(transaction, organizationId, actorId, 'owner'))
      ) {
        throw new APIError('UNAUTHORIZED');
      }

      const currentKey = await readCurrentMachineKey(transaction, installationId, organizationId);
      const currentKeyId = currentKey?.keyId ?? null;

      if (action === 'issue') {
        if (currentKeyId) {
          throw new APIError('CONFLICT', { message: 'An active machine key already exists' });
        }
      } else {
        if (!currentKeyId || currentKeyId !== parsed.output.keyId) {
          throw new APIError('NOT_FOUND', { message: 'Active machine key not found' });
        }

        await disableKey(transaction, currentKeyId);

        if (action === 'revoke') {
          await transaction.insert(schema.appAccessEvents).values({
            actorId,
            installationId,
            action: 'machine_key.revoked',
            details: { keyId: currentKeyId },
          });
          return { action };
        }
      }

      const key = await auth.api.createApiKey({
        headers,
        body: {
          configId: applicationKeyConfiguration,
          organizationId,
          name: 'Installation status',
        },
      });

      if (!key.key || !key.expiresAt) {
        throw new Error('Expiring machine key was not issued');
      }

      const [{ id: principalId }] = await transaction
        .insert(schema.appMachinePrincipals)
        .values({ installationId, organizationId })
        .onConflictDoUpdate({
          target: schema.appMachinePrincipals.installationId,
          set: { installationId },
        })
        .returning({ id: schema.appMachinePrincipals.id });
      await transaction.insert(schema.appMachineKeys).values({
        keyId: key.id,
        principalId,
        organizationId,
      });
      await transaction.insert(schema.appAccessEvents).values({
        actorId,
        installationId,
        action: action === 'issue' ? 'machine_key.issued' : 'machine_key.rotated',
        details: {
          keyId: key.id,
          previousKeyId: currentKeyId,
        },
      });
      return {
        action,
        keyId: key.id,
        key: key.key,
        expiresAt: key.expiresAt,
      };
    });
  });
}
