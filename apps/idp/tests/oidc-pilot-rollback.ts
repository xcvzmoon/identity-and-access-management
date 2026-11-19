import type { createDatabase } from '../../../packages/database/src/utils/client.ts';
import * as oidc from 'openid-client';
import { expect } from 'vite-plus/test';

type Database = ReturnType<typeof createDatabase>;
type PilotTarget = {
  app: { clientId: string; installationId: string };
  actorId: string;
  memberId: string;
};
const success = 200;
const unauthorized = 401;
const singleKey = 1;

export async function verifyReplicaSigningKey(
  database: Database,
  origins: readonly string[],
): Promise<void> {
  expect(await database.$client`select id from iam.jwks`).toEqual([]);
  const keySets = await Promise.all(
    origins.map(async (origin) => {
      const response = await fetch(new URL('/api/auth/jwks', origin));
      expect(response.status).toBe(success);
      const keySet: unknown = await response.json();
      return keySet;
    }),
  );
  const persistedKeys = await database.$client<{ id: string }[]>`select id from iam.jwks`;
  expect(persistedKeys).toHaveLength(singleKey);
  const [signingKey] = persistedKeys;

  for (const keySet of keySets) {
    expect(keySet).toEqual({
      keys: [
        expect.objectContaining({
          kid: signingKey.id,
          alg: 'RS256',
        }),
      ],
    });
  }
}

type AdminOperation =
  | { action: 'manage-client'; clientId: string; operation: 'rotate-secret' | 'disable' }
  | {
      action: 'change-assignment';
      installationId: string;
      change: { action: 'revoke'; memberId: string };
    };

export async function submitAdminOperation(
  issuer: string,
  cookie: string,
  operation: AdminOperation,
): Promise<Response> {
  return fetch(`${issuer}/api/auth/admin/interaction`, {
    method: 'POST',
    headers: {
      origin: issuer,
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify(operation),
  });
}

async function verifyPilotAccessDenied(
  config: oidc.Configuration,
  token: string,
  actorId: string,
): Promise<void> {
  await expect(oidc.tokenIntrospection(config, token)).rejects.toMatchObject({
    status: unauthorized,
    code: 'OAUTH_WWW_AUTHENTICATE_CHALLENGE',
  });
  await expect(oidc.fetchUserInfo(config, token, actorId)).rejects.toMatchObject({
    status: unauthorized,
  });
}

async function verifyRollbackAudit(database: Database, member: PilotTarget): Promise<void> {
  const events = await database.$client<{ action: string; details: object }[]>`
    select action, details
    from iam.app_access_events
    where installation_id = ${member.app.installationId}
      and actor_id = ${member.actorId}
      and action in ('client.disabled', 'assignment.revoked')
    order by created_at, id
  `;
  expect(events).toEqual([
    {
      action: 'client.disabled',
      details: { clientId: member.app.clientId },
    },
    {
      action: 'assignment.revoked',
      details: { memberId: member.memberId },
    },
  ]);
}

export type RollbackSession = {
  replicas: readonly oidc.Configuration[];
  cookie: string;
  accessToken: string;
};

export async function containPilot(
  database: Database,
  issuer: string,
  member: PilotTarget,
  session: RollbackSession,
): Promise<void> {
  const { app, actorId, memberId } = member;
  const { replicas, cookie, accessToken } = session;
  const active = await Promise.all(
    replicas.map(async (config) => oidc.tokenIntrospection(config, accessToken)),
  );

  for (const status of active) {
    expect(status).toMatchObject({
      active: true,
      sub: actorId,
    });
  }

  const disabled = await submitAdminOperation(issuer, cookie, {
    action: 'manage-client',
    operation: 'disable',
    clientId: app.clientId,
  });
  expect(disabled.status).toBe(success);
  expect(await disabled.json()).toEqual({ action: 'disable' });
  await Promise.all(
    replicas.map(async (config) => verifyPilotAccessDenied(config, accessToken, actorId)),
  );
  const revoked = await submitAdminOperation(issuer, cookie, {
    action: 'change-assignment',
    installationId: app.installationId,
    change: {
      action: 'revoke',
      memberId,
    },
  });
  expect(revoked.status).toBe(success);
  expect(await revoked.json()).toEqual({ action: 'change-assignment' });
  await verifyRollbackAudit(database, member);
}
