import type { useDatabase } from '@iam/database';
import type { CurrentMachineKey } from './current-machine-key.ts';
import { schema } from '@iam/database';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { readCurrentMachineKey } from './current-machine-key.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Reader = Pick<ReturnType<typeof useDatabase>, 'select'>;
type CredentialScope = { installationId: string; organizationId: string; actorId: string };
type Client = {
  clientId: string;
  disabled: boolean;
  credentialVersion: string;
  redirectUris: string[];
};
export type CredentialOverview = {
  clients: Client[];
  machine: { activeKey: CurrentMachineKey | null } | null;
};

export async function readApplicationCredentialOverview(
  database: Reader,
  scope: CredentialScope,
): Promise<CredentialOverview> {
  const { installationId, organizationId, actorId } = scope;
  const { appClients, oauthClients } = schema;
  const clients = await database
    .select({
      clientId: appClients.clientId,
      disabled: sql<boolean>`coalesce(${oauthClients.disabled}, true)`,
      credentialVersion: appClients.credentialVersion,
      redirectUris: oauthClients.redirectUris,
    })
    .from(appClients)
    .innerJoin(oauthClients, eq(oauthClients.clientId, appClients.clientId))
    .where(and(eq(appClients.installationId, installationId), isNull(appClients.deletedAt)))
    .orderBy(asc(appClients.clientId));
  const canManageMachine = await lockOrganizationAdmin(database, organizationId, actorId, 'owner');
  return {
    clients,
    machine: canManageMachine
      ? { activeKey: await readCurrentMachineKey(database, installationId, organizationId) }
      : null,
  };
}
