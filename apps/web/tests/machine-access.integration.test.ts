import type { AuthOptions } from '../../../packages/auth/src/utils/auth.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { applicationKeyConfiguration } from '../../../packages/auth/src/utils/application-machine-endpoint.ts';
import { createAuth } from '../../../packages/auth/src/utils/auth.ts';
import { manageApplicationMachineKey } from '../../../packages/auth/src/utils/manage-application-machine-key.ts';
import { registerApplication } from '../../../packages/auth/src/utils/register-application.ts';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';

const configuredIssuer = process.env.AUTH_WEB_TEST_URL;
const issuer = configuredIssuer ?? 'http://127.0.0.1:5173';
const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const secretBytes = 32;
const success = 200;
const forbidden = 403;
const unauthorized = 401;
const notFound = 404;
const tooManyRequests = 429;
const statusEndpoint = `${issuer}/api/auth/machine/installation`;
const hostedAuthSecret = process.env.AUTH_SECRET;
const installationSchema = valibot.object({
  principalId: valibot.pipe(valibot.string(), valibot.uuid()),
  installationId: valibot.pipe(valibot.string(), valibot.uuid()),
  applicationId: valibot.pipe(valibot.string(), valibot.uuid()),
  status: valibot.literal('active'),
});

type Database = ReturnType<typeof createDatabase>;
type MachineFixture = {
  options: AuthOptions;
  sessionHeaders: Headers;
  installationId: string;
  otherInstallationId: string;
  applicationId: string;
  ownerId: string;
  organizationId: string;
};
type MachineCredential = { keyId: string; key: string; expiresAt: Date };

async function setupApplications(
  database: Database,
  slug: string,
  email: string,
): Promise<MachineFixture> {
  const options: AuthOptions = {
    secret: hostedAuthSecret ?? randomBytes(secretBytes).toString('hex'),
    url: issuer,
    webOrigin: issuer,
  };
  const auth = createAuth(database, options);
  const signup = await auth.api.signUpEmail({
    body: {
      email,
      name: 'Machine owner',
      password: 'machine-integration-test-password',
    },
  });
  const ownerId = signup.user.id;
  await database.$client`update iam.users set email_verified = true where id = ${ownerId}`;
  const signedIn = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email,
      password: 'machine-integration-test-password',
    },
  });
  const organization = await auth.api.createOrganization({
    body: {
      name: 'Machine organization',
      slug,
      userId: ownerId,
    },
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((header) => header.split(';').shift())
    .join('; ');
  const sessionHeaders = new Headers({ cookie });
  const input = {
    organizationId: organization.id,
    redirectUri: 'https://machine-fixture.example.test/callback',
  };
  const app = await registerApplication(database, options, sessionHeaders, {
    ...input,
    name: 'Machine fixture',
  });
  const other = await registerApplication(database, options, sessionHeaders, {
    ...input,
    name: 'Other machine fixture',
  });

  return {
    options,
    sessionHeaders,
    installationId: app.installationId,
    otherInstallationId: other.installationId,
    applicationId: app.applicationId,
    ownerId,
    organizationId: organization.id,
  };
}

async function issueKey(database: Database, fixture: MachineFixture): Promise<MachineCredential> {
  const { options, sessionHeaders, installationId } = fixture;
  const issued = await manageApplicationMachineKey(database, options, sessionHeaders, {
    action: 'issue',
    installationId,
  });

  if (issued.action !== 'issue') {
    throw new Error('Expected a machine credential');
  }

  return issued;
}

async function credentialOverview(fixture: MachineFixture): Promise<Response> {
  const headers = new Headers(fixture.sessionHeaders);
  headers.set('origin', issuer);
  headers.set('content-type', 'application/json');
  return fetch(`${issuer}/api/auth/admin/access`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      collection: 'credentials',
      installationId: fixture.installationId,
    }),
  });
}

async function verifyCredentialOverview(
  database: Database,
  fixture: MachineFixture,
  credential: MachineCredential,
): Promise<void> {
  const { ownerId, organizationId, installationId } = fixture;
  const withoutProof = await credentialOverview(fixture);
  expect(withoutProof.status).toBe(forbidden);
  expect(await withoutProof.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  const passkeyId = randomUUID();
  await database.$client`insert into iam.passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up)
    values (${passkeyId}, ${ownerId}, ${randomUUID()}, 'test fixture', 0, 'singleDevice', false)`;
  await database.$client`update iam.sessions set admin_passkey_id = ${passkeyId}, admin_verified_at = now() where user_id = ${ownerId}`;
  const [{ client_id: clientId, credential_version: credentialVersion }] = await database.$client<
    { client_id: string; credential_version: string }[]
  >`select client_id, credential_version from iam.app_clients where installation_id = ${installationId}`;
  const response = await credentialOverview(fixture);
  expect(response.status).toBe(success);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const clients = [
    {
      clientId,
      credentialVersion,
      disabled: false,
      redirectUris: ['https://machine-fixture.example.test/callback'],
    },
  ];
  expect(await response.json()).toEqual({
    clients,
    machine: {
      activeKey: {
        keyId: credential.keyId,
        expiresAt: credential.expiresAt.toISOString(),
      },
    },
  });
  await database.$client`update iam.members set role = 'admin' where user_id = ${ownerId} and organization_id = ${organizationId}`;

  try {
    const admin = await credentialOverview(fixture);
    expect(admin.status).toBe(success);
    expect(await admin.json()).toEqual({
      clients,
      machine: null,
    });
  } finally {
    await database.$client`update iam.members set role = 'owner' where user_id = ${ownerId} and organization_id = ${organizationId}`;
  }
}

async function useMachineKey(key: string): Promise<Response> {
  return fetch(statusEndpoint, { headers: { 'x-api-key': key } });
}

async function expectMachineStatus(key: string, status: number): Promise<void> {
  const response = await useMachineKey(key);
  expect(response.status).toBe(status);
  await response.body?.cancel();
}

async function verifyCredentialIsolation(
  database: Database,
  fixture: MachineFixture,
  credential: MachineCredential,
): Promise<string> {
  const { installationId, applicationId, options } = fixture;
  const { keyId, key, expiresAt } = credential;
  const response = await useMachineKey(key);
  expect(response.status).toBe(success);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.getSetCookie()).toEqual([]);
  const result = valibot.parse(installationSchema, await response.json());
  expect(result.installationId).toBe(installationId);
  expect(result.applicationId).toBe(applicationId);
  const [stored] = await database.$client<{ key: string; expires_as_issued: boolean }[]>`
    select key, expires_at = ${expiresAt.toISOString()}::timestamptz as expires_as_issued
    from iam.api_keys where id = ${keyId}
  `;
  expect(stored.key).toBeTruthy();
  expect(stored.key).not.toBe(key);
  expect(stored.expires_as_issued).toBe(true);

  const auth = createAuth(database, options);
  const session = await auth.api.getSession({ headers: new Headers({ 'x-api-key': key }) });
  expect(session).toBeNull();
  const humanSession = await fetch(statusEndpoint, { headers: fixture.sessionHeaders });
  expect(humanSession.status).toBe(unauthorized);
  const unbound = await auth.api.createApiKey({
    headers: fixture.sessionHeaders,
    body: {
      configId: applicationKeyConfiguration,
      organizationId: fixture.organizationId,
      name: 'Unbound fixture',
    },
  });
  await expectMachineStatus(unbound.key, unauthorized);
  const browser = await fetch(statusEndpoint, {
    headers: {
      'x-api-key': key,
      origin: issuer,
    },
  });
  expect(browser.status).toBe(unauthorized);
  return result.principalId;
}

async function verifyRotation(
  database: Database,
  fixture: MachineFixture,
  credential: MachineCredential,
  principalId: string,
): Promise<void> {
  const { options, sessionHeaders, installationId, otherInstallationId } = fixture;
  const { keyId, key } = credential;
  await expect(issueKey(database, fixture)).rejects.toMatchObject({ status: 'CONFLICT' });
  await expect(
    manageApplicationMachineKey(database, options, sessionHeaders, {
      action: 'revoke',
      installationId: otherInstallationId,
      keyId,
    }),
  ).rejects.toMatchObject({ status: 'NOT_FOUND' });
  const rotated = await manageApplicationMachineKey(database, options, sessionHeaders, {
    action: 'rotate',
    installationId,
    keyId,
  });

  if (rotated.action !== 'rotate') {
    throw new Error('Expected a replacement credential');
  }

  await expectMachineStatus(key, unauthorized);
  const response = await useMachineKey(rotated.key);
  expect(response.status).toBe(success);
  expect(valibot.parse(installationSchema, await response.json()).principalId).toBe(principalId);

  await manageApplicationMachineKey(database, options, sessionHeaders, {
    action: 'revoke',
    installationId,
    keyId: rotated.keyId,
  });
  await expectMachineStatus(rotated.key, unauthorized);
}

async function verifyExpiryAndRateLimit(
  database: Database,
  fixture: MachineFixture,
): Promise<void> {
  const { key, keyId } = await issueKey(database, fixture);
  await database.$client`update iam.api_keys set rate_limit_max = 1 where id = ${keyId}`;
  await expectMachineStatus(key, success);
  await expectMachineStatus(key, tooManyRequests);
  await database.$client`update iam.api_keys set expires_at = now() - interval '1 minute' where id = ${keyId}`;
  await expectMachineStatus(key, unauthorized);
  const active = await issueKey(database, fixture);
  await database.$client`update iam.app_installations set deleted_at = now() where id = ${fixture.installationId}`;
  await expectMachineStatus(active.key, unauthorized);
}

async function removeFixture(database: Database, slug: string, email: string): Promise<void> {
  await database.$client.begin(async (transaction) => {
    await transaction`delete from iam.app_access_events where installation_id in (
      select installation.id from iam.app_installations installation
      join iam.organizations organization on organization.id = installation.organization_id
      where organization.slug = ${slug}
    )`;
    await transaction`delete from iam.api_keys where reference_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.app_machine_principals where organization_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.app_clients where client_id in (
      select client_id from iam.oauth_clients where reference_id in (
        select id::text from iam.organizations where slug = ${slug}
      )
    )`;
    await transaction`delete from iam.oauth_clients where reference_id in (
      select id::text from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.app_installations where organization_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.applications where organization_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.organizations where slug = ${slug}`;
    await transaction`delete from iam.users where email = ${email}`;
  });
}

test.skipIf(!configuredIssuer || !databasePort)(
  'machine credentials are scoped and revocable',
  async () => {
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    const slug = randomUUID();
    const email = `${slug}@example.test`;

    try {
      const fixture = await setupApplications(database, slug, email);
      const credential = await issueKey(database, fixture);

      if (hostedAuthSecret) {
        await verifyCredentialOverview(database, fixture, credential);
      }

      const principalId = await verifyCredentialIsolation(database, fixture, credential);
      await verifyRotation(database, fixture, credential, principalId);
      await verifyExpiryAndRateLimit(database, fixture);
      const management = await fetch(`${issuer}/api/auth/api-key/create`, { method: 'POST' });
      expect(management.status).toBe(notFound);
      const audit = await database.$client<
        { action: string; details: Record<string, string | null> }[]
      >`
      select action, details from iam.app_access_events
      where installation_id = ${fixture.installationId} and actor_id = ${fixture.ownerId}
        and action like 'machine_key.%'
      order by created_at, id
    `;
      expect(audit.map(({ action }) => action)).toEqual([
        'machine_key.issued',
        'machine_key.rotated',
        'machine_key.revoked',
        'machine_key.issued',
        'machine_key.issued',
      ]);
      expect(JSON.stringify(audit)).not.toContain(credential.key);
    } finally {
      try {
        await removeFixture(database, slug, email);
      } finally {
        await database.$client.end();
      }
    }
  },
);
