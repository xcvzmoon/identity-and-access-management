import type { useDatabase } from '@iam/database';
import type { AuthOptions } from '../../../packages/auth/src/utils/auth.ts';
import type { ClientChange } from '../../../packages/auth/src/utils/manage-application-client.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as valibot from 'valibot';
import { afterAll, describe, expect, test } from 'vite-plus/test';
import { createAuth } from '../../../packages/auth/src/utils/auth.ts';
import { manageApplicationClient } from '../../../packages/auth/src/utils/manage-application-client.ts';
import { registerApplication } from '../../../packages/auth/src/utils/register-application.ts';
import {
  resolveApplicationAccess,
  resolveApplicationGrant,
} from '../../../packages/database/src/utils/application-access.ts';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';
import {
  changeApplicationAssignment,
  registerApplicationPermissions,
  saveApplicationRole,
} from '../../../packages/database/src/utils/manage-application-access.ts';

const port = Number(process.env.AUTH_TEST_DB_PORT);
const issuer = 'http://localhost:3000';
const secretBytes = 32;
const identifier = randomUUID();
const callback = 'https://client.example.test/callback';
const ok = 200;
const badRequest = 400;
const found = 302;

function connectDatabase(): ReturnType<typeof useDatabase> {
  return createDatabase({
    host: '127.0.0.1',
    port,
    user: 'iam',
    password: 'disposable',
    database: 'iam',
    ssl: false,
    logger: false,
  });
}

type Database = ReturnType<typeof useDatabase>;

type OrganizationFixture = {
  options: AuthOptions;
  headers: Headers;
  ownerId: string;
  otherId: string;
  ownerMemberId: string;
  otherMemberId: string;
  userId: string;
};

async function prepareOrganizations(database: Database): Promise<OrganizationFixture> {
  const options = {
    secret: process.env.AUTH_SECRET ?? randomBytes(secretBytes).toString('hex'),
    url: issuer,
    webOrigin: issuer,
  };
  const auth = createAuth(database, options);
  const signup = await auth.api.signUpEmail({
    body: {
      name: 'Fixture owner',
      email: `${identifier}@example.test`,
      password: 'fixture-only-password',
    },
  });
  await database.$client`update iam.users set email_verified = true where id = ${signup.user.id}`;
  const signedIn = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email: `${identifier}@example.test`,
      password: 'fixture-only-password',
    },
  });
  const { user } = signup;
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => {
      const [pair] = value.split(';');
      return pair;
    })
    .join('; ');
  const headers = new Headers({ cookie });
  const owner = await auth.api.createOrganization({
    body: {
      name: 'Owner organization',
      slug: identifier,
      userId: user.id,
    },
  });
  const other = await auth.api.createOrganization({
    body: {
      name: 'Other organization',
      slug: `${identifier}-other`,
      userId: user.id,
    },
  });
  const sql = database.$client;
  const [ownerMember] = await sql<{ id: string }[]>`
    select id from iam.members where user_id = ${user.id} and organization_id = ${owner.id}
  `;
  const [otherMember] = await sql<{ id: string }[]>`
    select id from iam.members where user_id = ${user.id} and organization_id = ${other.id}
  `;
  expect(ownerMember).toBeDefined();
  expect(otherMember).toBeDefined();
  return {
    options,
    headers,
    ownerId: owner.id,
    otherId: other.id,
    ownerMemberId: ownerMember.id,
    otherMemberId: otherMember.id,
    userId: user.id,
  };
}

type AppRegistration = Awaited<ReturnType<typeof registerApplication>>;

type AppCallback = { clientId: string; redirectUri?: string };

function authorizationUrl(client: AppCallback, verifier: string): URL {
  const url = new URL('/api/auth/oauth2/authorize', issuer);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri ?? callback,
    response_type: 'code',
    scope: 'openid',
    state: randomUUID(),
    nonce: randomUUID(),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url;
}

async function issueCode(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  client: AppCallback,
  verifier: string,
): Promise<string> {
  const url = authorizationUrl(client, verifier);
  const authorize = await auth.handler(new Request(url, { headers }));
  const location = authorize.headers.get('location');
  if (!location) {
    throw new Error(`Expected consent redirect, received ${authorize.status}`);
  }

  const consent = new URL(location);
  const existingConsentCode = consent.searchParams.get('code');
  if (existingConsentCode) {
    expect(consent.origin + consent.pathname).toBe(client.redirectUri ?? callback);
    return existingConsentCode;
  }

  expect(consent.pathname).toBe('/oidc/consent');
  const consentHeaders = new Headers(headers);
  consentHeaders.set('origin', issuer);
  consentHeaders.set('content-type', 'application/json');
  const response = await auth.handler(
    new Request(`${issuer}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: consentHeaders,
      body: JSON.stringify({
        accept: true,
        oauth_query: consent.searchParams.toString(),
      }),
    }),
  );
  const body = valibot.parse(valibot.object({ url: valibot.string() }), await response.json());
  const destination = new URL(body.url);
  expect(destination.origin + destination.pathname).toBe(client.redirectUri ?? callback);
  const code = destination.searchParams.get('code');
  if (!code) {
    throw new Error('Expected an authorization code');
  }

  return code;
}

async function exchangeCode(
  auth: ReturnType<typeof createAuth>,
  registration: AppRegistration & AppCallback,
  code: string,
  verifier: string,
): Promise<Response> {
  const credential = Buffer.from(`${registration.clientId}:${registration.clientSecret}`);
  return auth.handler(
    new Request(`${issuer}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${credential.toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: registration.redirectUri ?? callback,
        code_verifier: verifier,
      }),
    }),
  );
}

async function verifyOidcExchange(
  database: Database,
  fixture: OrganizationFixture,
  registration: AppRegistration,
  assignmentId: string,
): Promise<void> {
  const { options, headers } = fixture;
  const auth = createAuth(database, options);
  const verifier = randomBytes(secretBytes).toString('base64url');
  const wrongVerifierCode = await issueCode(auth, headers, registration, verifier);
  const wrongVerifier = randomBytes(secretBytes).toString('base64url');
  const wrongProof = await exchangeCode(auth, registration, wrongVerifierCode, wrongVerifier);
  expect(wrongProof.status).toBe(badRequest);
  expect(await wrongProof.json()).toMatchObject({ error: 'invalid_grant' });

  const code = await issueCode(auth, headers, registration, verifier);
  const attempts = await Promise.all([
    exchangeCode(auth, registration, code, verifier),
    exchangeCode(auth, registration, code, verifier),
  ]);
  const [success, replay] = attempts.toSorted((left, right) => left.status - right.status);
  expect(success.status).toBe(ok);
  expect(replay.status).toBe(badRequest);
  expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
  const tokenSchema = valibot.object({
    access_token: valibot.pipe(valibot.string(), valibot.nonEmpty()),
    id_token: valibot.pipe(valibot.string(), valibot.nonEmpty()),
  });
  expect(valibot.safeParse(tokenSchema, await success.json()).success).toBe(true);
  const secondCode = await issueCode(auth, headers, registration, verifier);
  await database.$client`update iam.app_assignments set deleted_at = now() where id = ${assignmentId}`;
  const rejected = await exchangeCode(auth, registration, secondCode, verifier);
  expect(rejected.status).toBe(badRequest);
  expect(await rejected.json()).toEqual({ error: 'invalid_grant' });
}

async function verifyRoleWrites(
  database: Database,
  manager: { actorId: string; installationId: string },
  registration: AppRegistration,
  memberId: string,
): Promise<void> {
  const { actorId, installationId } = manager;
  const { clientId } = registration;
  const read = 'documents.read';
  const approve = 'documents.approve';
  const key = 'reviewer';
  await Promise.all([
    saveApplicationRole(database, manager, {
      key,
      permissionKeys: [read],
    }),
    saveApplicationRole(database, manager, {
      key,
      permissionKeys: [approve],
    }),
  ]);
  const [canRead, canApprove] = await Promise.all([
    resolveApplicationAccess(database, clientId, actorId, read),
    resolveApplicationAccess(database, clientId, actorId, approve),
  ]);
  expect(Boolean(canRead)).not.toBe(Boolean(canApprove));

  await changeApplicationAssignment(database, manager, {
    action: 'revoke',
    memberId,
  });
  expect(await resolveApplicationAccess(database, clientId, actorId)).toBeNull();
  await changeApplicationAssignment(database, manager, {
    action: 'grant',
    memberId,
    roleKeys: [],
  });
  expect(await resolveApplicationAccess(database, clientId, actorId)).toBe(installationId);
  expect(await resolveApplicationAccess(database, clientId, actorId, read)).toBeNull();
  expect(await resolveApplicationAccess(database, clientId, actorId, approve)).toBeNull();
  const events = await database.$client<{ action: string }[]>`
    select action from iam.app_access_events
    where installation_id = ${installationId} and actor_id = ${actorId}
    order by created_at, id
  `;
  expect(events.map(({ action }) => action)).toEqual([
    'application.registered',
    'permissions.registered',
    'role.saved',
    'assignment.granted',
    'role.saved',
    'role.saved',
    'assignment.revoked',
    'assignment.granted',
  ]);
}

async function verifyMemberCannotManage(
  database: Database,
  fixture: OrganizationFixture,
  installationId: string,
): Promise<void> {
  const { userId, ownerMemberId } = fixture;
  await database.$client`update iam.members set role = 'member' where id = ${ownerMemberId}`;

  try {
    await expect(
      registerApplicationPermissions(
        database,
        {
          actorId: userId,
          installationId,
        },
        ['admin.write'],
      ),
    ).rejects.toThrow('APP_ACCESS_FORBIDDEN');
  } finally {
    await database.$client`update iam.members set role = 'owner' where id = ${ownerMemberId}`;
  }
}

async function verifyApplicationRoles(
  database: Database,
  fixture: OrganizationFixture,
  registration: AppRegistration,
): Promise<void> {
  const { options, headers, ownerId, ownerMemberId, otherMemberId, userId } = fixture;
  const other = await registerApplication(database, options, headers, {
    organizationId: ownerId,
    name: 'Second private application',
    redirectUri: callback,
  });
  const manager = {
    actorId: userId,
    installationId: registration.installationId,
  };
  const otherManager = {
    actorId: userId,
    installationId: other.installationId,
  };
  const read = 'documents.read';
  const approve = 'documents.approve';
  const roleKey = 'reviewer';
  await registerApplicationPermissions(database, manager, [read, approve]);
  await registerApplicationPermissions(database, otherManager, [read]);
  await saveApplicationRole(database, manager, {
    key: roleKey,
    permissionKeys: [read],
  });
  await saveApplicationRole(database, otherManager, {
    key: roleKey,
    permissionKeys: [read],
  });
  await expect(
    saveApplicationRole(database, otherManager, {
      key: roleKey,
      permissionKeys: [approve],
    }),
  ).rejects.toThrow();
  await expect(
    changeApplicationAssignment(database, manager, {
      action: 'grant',
      memberId: otherMemberId,
      roleKeys: [roleKey],
    }),
  ).rejects.toThrow('APP_MEMBER_UNAVAILABLE');

  await changeApplicationAssignment(database, manager, {
    action: 'grant',
    memberId: ownerMemberId,
    roleKeys: [roleKey],
  });
  expect(await resolveApplicationAccess(database, registration.clientId, userId, read)).toBe(
    registration.installationId,
  );
  expect(await resolveApplicationAccess(database, other.clientId, userId, read)).toBeNull();
  expect(
    await resolveApplicationAccess(database, registration.clientId, userId, approve),
  ).toBeNull();

  await expect(database.$client`
    insert into iam.app_assignment_roles (installation_id, assignment_id, role_id)
    select assignment.installation_id, assignment.id, role.id
    from iam.app_assignments assignment
    cross join iam.app_roles role
    where assignment.installation_id = ${registration.installationId}
      and assignment.member_id = ${ownerMemberId}
      and role.installation_id = ${other.installationId}
      and role.key = ${roleKey}
  `).rejects.toMatchObject({ constraint_name: 'app_assignment_roles_role_fk' });
  await changeApplicationAssignment(database, otherManager, {
    action: 'grant',
    memberId: ownerMemberId,
    roleKeys: [roleKey],
  });
  expect(await resolveApplicationAccess(database, other.clientId, userId, read)).toBe(
    other.installationId,
  );
  await changeApplicationAssignment(database, otherManager, {
    action: 'grant',
    memberId: ownerMemberId,
    roleKeys: [],
  });
  expect(await resolveApplicationAccess(database, other.clientId, userId)).toBe(
    other.installationId,
  );
  expect(await resolveApplicationAccess(database, other.clientId, userId, read)).toBeNull();
  await verifyRoleWrites(database, manager, registration, ownerMemberId);
}

async function verifyClientOperations(
  database: Database,
  fixture: OrganizationFixture,
  registration: AppRegistration,
): Promise<void> {
  const { options, headers, userId } = fixture;
  const { clientId, installationId } = registration;
  const auth = createAuth(database, options);
  const verifier = randomBytes(secretBytes).toString('base64url');
  const code = await issueCode(auth, headers, registration, verifier);
  const [{ credential_version: expectedVersion }] = await database.$client<
    { credential_version: string }[]
  >`select credential_version from iam.app_clients where client_id = ${clientId}`;
  const rotated = await manageApplicationClient(database, options, headers, {
    clientId,
    action: 'rotate-secret',
    expectedVersion,
  });

  if (rotated.action !== 'rotate-secret') {
    throw new Error('Expected a rotated client secret');
  }

  expect(rotated.clientSecret).not.toBe(registration.clientSecret);
  expect(rotated.credentialVersion).not.toBe(expectedVersion);
  await expect(
    manageApplicationClient(database, options, headers, {
      clientId,
      action: 'rotate-secret',
      expectedVersion,
    }),
  ).rejects.toMatchObject({ status: 'CONFLICT' });
  const stale = await exchangeCode(auth, registration, code, verifier);
  expect(stale.ok).toBe(false);
  const updated = {
    ...registration,
    clientSecret: rotated.clientSecret,
  };
  const staleCode = await exchangeCode(auth, updated, code, verifier);
  expect(await staleCode.json()).toEqual({ error: 'invalid_grant' });
  const nextCode = await issueCode(auth, headers, registration, verifier);
  const current = await exchangeCode(auth, updated, nextCode, verifier);
  expect(current.ok).toBe(true);

  await manageApplicationClient(database, options, headers, {
    clientId,
    action: 'disable',
  });
  expect(await resolveApplicationAccess(database, clientId, userId)).toBeNull();
  const events = await database.$client<{ action: string; details: { clientId: string } }[]>`
    select action, details from iam.app_access_events
    where installation_id = ${installationId}
      and action in ('client.secret_rotated', 'client.disabled')
    order by created_at, id
  `;
  expect(events).toEqual([
    {
      action: 'client.secret_rotated',
      details: { clientId },
    },
    {
      action: 'client.disabled',
      details: { clientId },
    },
  ]);
  const outstanding = await database.$client`
    select id from iam.oauth_access_tokens where client_id = ${clientId} and revoked is null
  `;
  expect(outstanding).toEqual([]);
}

async function verifyExactCallback(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  registration: AppRegistration,
  redirectUri: string,
): Promise<void> {
  const verifier = randomBytes(secretBytes).toString('base64url');
  const replies = await Promise.all(
    [callback, `${redirectUri}/`].map(async (candidate) =>
      auth.handler(
        new Request(
          authorizationUrl(
            {
              clientId: registration.clientId,
              redirectUri: candidate,
            },
            verifier,
          ),
          { headers },
        ),
      ),
    ),
  );

  for (const reply of replies) {
    expect(reply.status).toBe(found);
    const location = new URL(reply.headers.get('location') ?? issuer);
    expect(location.origin + location.pathname).toBe(`${issuer}/api/auth/error`);
    expect(location.searchParams.get('error')).toBe('invalid_redirect');
    expect(location.searchParams.has('code')).toBe(false);
  }

  const updated = { ...registration, redirectUri };
  const fresh = await issueCode(auth, headers, updated, verifier);
  const exchanged = await exchangeCode(auth, updated, fresh, verifier);
  expect(exchanged.ok).toBe(true);
}

async function verifyCallbackReplacement(
  database: Database,
  fixture: OrganizationFixture,
): Promise<void> {
  const { options, headers, ownerId, ownerMemberId, userId } = fixture;
  const registration = await registerApplication(database, options, headers, {
    organizationId: ownerId,
    name: 'Callback management fixture',
    redirectUri: callback,
  });
  const { clientId, installationId } = registration;
  await changeApplicationAssignment(
    database,
    {
      actorId: userId,
      installationId,
    },
    {
      action: 'grant',
      memberId: ownerMemberId,
      roleKeys: [],
    },
  );
  const [{ credential_version: expectedVersion }] = await database.$client<
    { credential_version: string }[]
  >`select credential_version from iam.app_clients where client_id = ${clientId}`;
  const auth = createAuth(database, options);
  const verifier = randomBytes(secretBytes).toString('base64url');
  const issued = await issueCode(auth, headers, registration, verifier);
  const token = await exchangeCode(auth, registration, issued, verifier);
  expect(token.ok).toBe(true);
  const pending = await issueCode(auth, headers, registration, verifier);
  const change = {
    action: 'replace-callback',
    clientId,
    expectedVersion,
    redirectUri: 'https://client.example.test/callback-v2',
  } satisfies ClientChange;
  await expect(
    manageApplicationClient(database, options, headers, {
      ...change,
      redirectUri: 'https://*.example.test/callback',
    }),
  ).rejects.toMatchObject({ status: 'BAD_REQUEST' });
  const replaced = await manageApplicationClient(database, options, headers, change);
  if (replaced.action !== 'replace-callback') {
    throw new Error('Expected a callback update');
  }

  expect(replaced.credentialVersion).not.toBe(expectedVersion);
  await expect(manageApplicationClient(database, options, headers, change)).rejects.toMatchObject({
    status: 'CONFLICT',
  });
  await expect(
    manageApplicationClient(database, options, headers, {
      ...change,
      expectedVersion: replaced.credentialVersion,
    }),
  ).resolves.toEqual(replaced);
  const invalidated = await exchangeCode(auth, registration, pending, verifier);
  expect(await invalidated.json()).toEqual({ error: 'invalid_grant' });
  const revoked = await database.$client`select id from iam.oauth_access_tokens
    where client_id = ${clientId} and revoked is null`;
  expect(revoked).toEqual([]);
  expect(await resolveApplicationGrant(database, clientId, userId, callback)).toBeNull();
  expect(
    await resolveApplicationGrant(database, clientId, userId, change.redirectUri),
  ).toBeTruthy();
  const audit = await database.$client`select details from iam.app_access_events
    where installation_id = ${installationId} and action = 'client.callback_replaced'`;
  expect(audit).toEqual([{ details: { clientId } }]);
  await verifyExactCallback(auth, headers, registration, change.redirectUri);
}

async function verifyClientChanges(
  database: Database,
  fixture: OrganizationFixture,
  registration: AppRegistration,
): Promise<void> {
  await verifyClientOperations(database, fixture, registration);
  await verifyCallbackReplacement(database, fixture);
}

async function cleanupOrganizations(database: Database): Promise<void> {
  const sql = database.$client;

  try {
    await sql.begin(async (transaction) => {
      await transaction`delete from iam.app_access_events where installation_id in (
        select id from iam.app_installations where organization_id in (
          select id from iam.organizations where slug in (${identifier}, ${`${identifier}-other`})
        )
      )`;
      await transaction`delete from iam.app_roles where installation_id in (
        select id from iam.app_installations where organization_id in (
          select id from iam.organizations where slug in (${identifier}, ${`${identifier}-other`})
        )
      )`;
      await transaction`delete from iam.app_permissions where application_id in (
        select id from iam.applications where organization_id in (
          select id from iam.organizations where slug in (${identifier}, ${`${identifier}-other`})
        )
      )`;
      await transaction`delete from iam.app_assignments where organization_id in (
        select id from iam.organizations where slug in (${identifier}, ${`${identifier}-other`})
      )`;
      await transaction`delete from iam.app_clients where client_id in (
        select client_id from iam.oauth_clients where reference_id in (
          select id::text from iam.organizations where slug = ${identifier}
        )
      )`;
      await transaction`delete from iam.oauth_clients where reference_id in (
        select id::text from iam.organizations where slug = ${identifier}
      )`;
      await transaction`delete from iam.app_installations where organization_id in (
        select id from iam.organizations where slug in (${identifier}, ${`${identifier}-other`})
      )`;
      await transaction`delete from iam.applications where organization_id in (
        select id from iam.organizations where slug = ${identifier}
      )`;
      await transaction`delete from iam.organizations where slug in (${identifier}, ${`${identifier}-other`})`;
      await transaction`delete from iam.users where email = ${`${identifier}@example.test`}`;
    });
  } finally {
    await sql.end();
  }
}

describe.skipIf(!port)('Private application access', () => {
  const database = connectDatabase();
  const sql = database.$client;

  afterAll(async () => cleanupOrganizations(database));

  test('enforces owner organization, explicit assignment, verification, and revocation', async () => {
    const fixture = await prepareOrganizations(database);
    const { options, headers, ownerId, otherId, ownerMemberId, otherMemberId, userId } = fixture;
    const assignmentId = randomUUID();
    const input = {
      organizationId: ownerId,
      name: 'Private application',
      redirectUri: callback,
    };

    await expect(
      registerApplication(database, options, headers, {
        ...input,
        redirectUri: 'http://client.example.test/callback',
      }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' });
    const registration = await registerApplication(database, options, headers, input);
    const { applicationId, installationId, clientId } = registration;
    const [client] = await sql<
      { client_secret: string; reference_id: string; require_pkce: boolean }[]
    >`
      select client_secret, reference_id, require_pkce from iam.oauth_clients where client_id = ${clientId}
    `;
    expect(client.client_secret).toBeTruthy();
    expect(client.client_secret).not.toBe(registration.clientSecret);
    expect(client.reference_id).toBe(ownerId);
    expect(client.require_pkce).toBe(true);

    await expect(sql`insert into iam.app_installations (id, organization_id, application_id)
      values (${randomUUID()}, ${otherId}, ${applicationId})`).rejects.toMatchObject({
      constraint_name: 'app_installations_owner_fk',
    });
    await expect(sql`insert into iam.app_assignments (id, organization_id, installation_id, member_id)
      values (${assignmentId}, ${ownerId}, ${installationId}, ${otherMemberId})`).rejects.toMatchObject(
      {
        constraint_name: 'app_assignments_member_fk',
      },
    );

    expect(await resolveApplicationAccess(database, clientId, userId)).toBeNull();
    await sql`insert into iam.app_assignments (id, organization_id, installation_id, member_id)
      values (${assignmentId}, ${ownerId}, ${installationId}, ${ownerMemberId})`;
    expect(await resolveApplicationAccess(database, clientId, userId)).toBe(installationId);

    await sql`update iam.users set email_verified = false where id = ${userId}`;
    expect(await resolveApplicationAccess(database, clientId, userId)).toBeNull();
    await sql`update iam.users set email_verified = true where id = ${userId}`;
    await sql`update iam.members set suspended_at = now() where id = ${ownerMemberId}`;
    expect(await resolveApplicationAccess(database, clientId, userId)).toBeNull();

    await sql`update iam.members set suspended_at = null where id = ${ownerMemberId}`;
    await verifyOidcExchange(database, fixture, registration, assignmentId);
    expect(await resolveApplicationAccess(database, clientId, userId)).toBeNull();
    await verifyMemberCannotManage(database, fixture, installationId);
    await verifyApplicationRoles(database, fixture, registration);
    await verifyClientChanges(database, fixture, registration);
  });
});
