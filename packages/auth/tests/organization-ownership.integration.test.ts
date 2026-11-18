import type { Auth } from '../src/utils/auth.ts';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../database/src/utils/client.ts';
import { createAuth } from '../src/utils/auth.ts';

const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const origin = 'http://localhost:5173';
const success = 200;
const badRequest = 400;
const forbidden = 403;
const firstRow = 0;

type Database = ReturnType<typeof createDatabase>;
type Actor = { id: string; cookie: string };
type Transfer = { organizationId: string; memberId: string };
type OwnershipFixture = {
  owner: Actor;
  administrator: Actor;
  target: Transfer;
  foreignTarget: Transfer;
};

async function createActor(database: Database, auth: Auth, email: string): Promise<Actor> {
  const signup = await auth.api.signUpEmail({
    body: {
      email,
      name: 'Ownership fixture',
      password: 'organization-ownership-test-password',
    },
  });
  await database.$client`update iam.users set email_verified = true where id = ${signup.user.id}`;
  const signedIn = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email,
      password: 'organization-ownership-test-password',
    },
  });

  return {
    id: signup.user.id,
    cookie: signedIn.headers
      .getSetCookie()
      .map((value) => value.split(';').shift())
      .join('; '),
  };
}

async function markPasskey(database: Database, actor: Actor): Promise<void> {
  const passkeyId = randomUUID();
  await database.$client`insert into iam.passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up)
    values (${passkeyId}, ${actor.id}, ${randomUUID()}, 'test fixture', 0, 'singleDevice', false)`;
  await database.$client`update iam.sessions set admin_passkey_id = ${passkeyId},
    admin_verified_at = now() where user_id = ${actor.id}`;
}

type RoleChange = Transfer & { role: 'member' | 'admin' };
type AppList = { collection: 'apps'; organizationId: string };
type Operation = 'transfer-ownership' | 'member-role' | 'access';

async function requestAdmin(
  auth: Auth,
  actor: Actor,
  operation: Operation,
  body: Transfer | RoleChange | AppList,
): Promise<Response> {
  return auth.handler(
    new Request(`${origin}/api/auth/admin/${operation}`, {
      method: 'POST',
      headers: {
        origin,
        cookie: actor.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
}

async function createFixture(
  database: Database,
  auth: Auth,
  slug: string,
): Promise<OwnershipFixture> {
  const owner = await createActor(database, auth, `owner-${slug}@example.test`);
  const administrator = await createActor(database, auth, `admin-${slug}@example.test`);
  const organization = await auth.api.createOrganization({
    body: {
      userId: owner.id,
      name: 'Ownership organization',
      slug,
    },
  });
  const outside = await auth.api.createOrganization({
    body: {
      userId: administrator.id,
      name: 'Another organization',
      slug: `other-${slug}`,
    },
  });
  const member = await auth.api.addMember({
    body: {
      organizationId: organization.id,
      userId: administrator.id,
      role: 'admin',
    },
  });
  const foreign = await database.$client<
    { id: string }[]
  >`select id from iam.members where organization_id = ${outside.id}`;
  const foreignMember = foreign.at(firstRow);
  if (!foreignMember) {
    throw new Error('Expected an owner in the foreign organization');
  }

  return {
    owner,
    administrator,
    target: {
      organizationId: organization.id,
      memberId: member.id,
    },
    foreignTarget: {
      organizationId: organization.id,
      memberId: foreignMember.id,
    },
  };
}

async function verifyTransferBoundaries(
  database: Database,
  auth: Auth,
  fixture: OwnershipFixture,
): Promise<void> {
  const { owner, administrator, target, foreignTarget } = fixture;
  const unverified = await requestAdmin(auth, owner, 'transfer-ownership', target);
  expect(unverified.status).toBe(forbidden);
  expect(await unverified.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  await Promise.all([markPasskey(database, owner), markPasskey(database, administrator)]);
  const forbiddenAdmin = await requestAdmin(auth, administrator, 'transfer-ownership', target);
  expect(forbiddenAdmin.status).toBe(forbidden);
  expect(await forbiddenAdmin.json()).toMatchObject({ code: 'ORGANIZATION_UNAVAILABLE' });
  const foreign = await requestAdmin(auth, owner, 'transfer-ownership', foreignTarget);
  expect(foreign.status).toBe(badRequest);
  expect(await foreign.json()).toMatchObject({ code: 'OWNERSHIP_RECIPIENT_UNAVAILABLE' });
}

async function verifyCommittedOwnership(
  database: Database,
  auth: Auth,
  fixture: OwnershipFixture,
): Promise<void> {
  const { owner, administrator, target } = fixture;
  const results = await Promise.all([
    requestAdmin(auth, owner, 'transfer-ownership', target),
    requestAdmin(auth, owner, 'transfer-ownership', target),
  ]);
  expect(results.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
    success,
    forbidden,
  ]);
  const roles = await database.$client<{ role: string; user_id: string }[]>`
    select role, user_id from iam.members where organization_id = ${target.organizationId} order by role
  `;
  expect(roles).toEqual([
    {
      role: 'admin',
      user_id: owner.id,
    },
    {
      role: 'owner',
      user_id: administrator.id,
    },
  ]);
  const privileged = await database.$client`select id from iam.sessions
    where user_id in (${owner.id}, ${administrator.id}) and admin_verified_at is not null`;
  expect(privileged).toEqual([]);
  const ownerSession = await auth.api.getSession({
    headers: new Headers({ cookie: owner.cookie }),
  });
  expect(ownerSession?.user.id).toBe(owner.id);
}

async function verifyOwnershipTransfer(
  database: Database,
  auth: Auth,
  fixture: OwnershipFixture,
): Promise<void> {
  await verifyTransferBoundaries(database, auth, fixture);
  await verifyCommittedOwnership(database, auth, fixture);
}

async function verifyDelegation(
  database: Database,
  auth: Auth,
  fixture: OwnershipFixture,
): Promise<void> {
  const { owner, administrator, target } = fixture;
  await database.$client`update iam.members set role = 'member' where id = ${target.memberId}`;
  const promotion: RoleChange = {
    ...target,
    role: 'admin',
  };
  const passwordOnly = await requestAdmin(auth, owner, 'member-role', promotion);
  expect(passwordOnly.status).toBe(forbidden);
  expect(await passwordOnly.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  await Promise.all([markPasskey(database, owner), markPasskey(database, administrator)]);
  const selfPromotion = await requestAdmin(auth, administrator, 'member-role', promotion);
  expect(selfPromotion.status).toBe(forbidden);
  const [{ id: ownerMemberId }] = await database.$client<{ id: string }[]>`
    select id from iam.members where organization_id = ${target.organizationId} and user_id = ${owner.id}
  `;
  const ownerDemotion = await requestAdmin(auth, owner, 'member-role', {
    organizationId: target.organizationId,
    memberId: ownerMemberId,
    role: 'member',
  });
  expect(ownerDemotion.status).toBe(badRequest);
  const promoted = await requestAdmin(auth, owner, 'member-role', promotion);
  expect(promoted.status).toBe(success);
  const lookup: AppList = {
    collection: 'apps',
    organizationId: target.organizationId,
  };
  const oldProof = await requestAdmin(auth, administrator, 'access', lookup);
  expect(oldProof.status).toBe(forbidden);
  expect(await oldProof.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  await markPasskey(database, administrator);
  const verifiedAccess = await requestAdmin(auth, administrator, 'access', lookup);
  expect(verifiedAccess.status).toBe(success);
  const demoted = await requestAdmin(auth, owner, 'member-role', {
    ...target,
    role: 'member',
  });
  expect(demoted.status).toBe(success);
  const sessions =
    await database.$client`select id from iam.sessions where user_id = ${administrator.id}
    and admin_verified_at is not null`;
  expect(sessions).toEqual([]);
  await markPasskey(database, administrator);
  const removed = await requestAdmin(auth, administrator, 'access', lookup);
  expect(removed.status).toBe(forbidden);
  expect(await removed.json()).toMatchObject({ code: 'APP_ACCESS_FORBIDDEN' });
}

const scenarios = [
  {
    name: 'ownership transfer preserves an owner and clears both participants’ step-up proofs',
    verify: verifyOwnershipTransfer,
  },
  {
    name: 'owners can delegate and remove admin access without reusing an older passkey proof',
    verify: verifyDelegation,
  },
];

test.skipIf(!databasePort).each(scenarios)('$name', async ({ verify }) => {
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
  const auth = createAuth(database, {
    secret: 'organization-ownership-integration-secret',
    url: origin,
    webOrigin: origin,
  });

  try {
    const fixture = await createFixture(database, auth, slug);
    await verify(database, auth, fixture);
  } finally {
    try {
      await database.$client`delete from iam.organizations where slug in (${slug}, ${`other-${slug}`})`;
      await database.$client`delete from iam.users where email in (${`owner-${slug}@example.test`}, ${`admin-${slug}@example.test`})`;
    } finally {
      await database.$client.end();
    }
  }
});
