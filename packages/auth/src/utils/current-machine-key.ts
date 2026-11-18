import type { useDatabase } from '@iam/database';
import { schema } from '@iam/database';
import { and, eq, gt, sql } from 'drizzle-orm';
import { applicationKeyConfiguration } from './application-machine-endpoint.ts';

type Reader = Pick<ReturnType<typeof useDatabase>, 'select'>;
export type CurrentMachineKey = { keyId: string; expiresAt: Date };
const firstRow = 0;

export async function readCurrentMachineKey(
  transaction: Reader,
  installationId: string,
  organizationId: string,
): Promise<CurrentMachineKey | null> {
  const keys = await transaction
    .select({
      keyId: schema.appMachineKeys.keyId,
      expiresAt: schema.apiKeys.expiresAt,
    })
    .from(schema.appMachinePrincipals)
    .innerJoin(
      schema.appMachineKeys,
      eq(schema.appMachineKeys.principalId, schema.appMachinePrincipals.id),
    )
    .innerJoin(schema.apiKeys, eq(schema.apiKeys.id, schema.appMachineKeys.keyId))
    .where(
      and(
        eq(schema.appMachinePrincipals.installationId, installationId),
        eq(schema.apiKeys.configId, applicationKeyConfiguration),
        eq(schema.apiKeys.referenceId, organizationId),
        eq(schema.apiKeys.enabled, true),
        gt(schema.apiKeys.expiresAt, sql`now()`),
      ),
    );
  const key = keys.at(firstRow);
  return key?.expiresAt
    ? {
        keyId: key.keyId,
        expiresAt: key.expiresAt,
      }
    : null;
}
