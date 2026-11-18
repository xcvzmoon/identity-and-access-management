import type { Auth } from '../src/utils/auth.ts';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../database/src/utils/client.ts';
import { createAuth } from '../src/utils/auth.ts';

const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const origin = 'http://localhost:5173';
const endpoint = `${origin}/api/auth/account/organization-invitations`;
const success = 200;
const badRequest = 400;
const forbidden = 403;
const firstRow = 0;
const single = 1;

type Database = ReturnType<typeof createDatabase>;
type Actor = { id: string; email: string; cookie: string };
type Command =
  | { action: 'list-mine' }
  | { action: 'list-pending'; organizationId: string }
  | { action: 'invite'; organizationId: string; email: string }
  | { action: 'cancel'; organizationId: string; invitationId: string }
  | { action: 'accept'; invitationId: string };
type Mail = { email: string; organizationName: string };

async function signUp(database: Database, auth: Auth, email: string): Promise<Actor> {
  const signup = await auth.api.signUpEmail({
    body: {
      email,
      name: 'Invitation fixture',
      password: 'organization-invitation-test-password',
    },
  });
  await database.$client`update iam.users set email_verified = true where id = ${signup.user.id}`;
  const signedIn = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email,
      password: 'organization-invitation-test-password',
    },
  });

  return {
    id: signup.user.id,
    email,
    cookie: signedIn.headers
      .getSetCookie()
      .map((value) => value.split(';').shift())
      .join('; '),
  };
}

async function request(auth: Auth, body: Command, actor: Actor): Promise<Response> {
  return auth.handler(
    new Request(endpoint, {
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

async function seedPasskey(database: Database, owner: Actor): Promise<void> {
  const passkeys = await database.$client<{ id: string }[]>`
    insert into iam.passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up)
    values (gen_random_uuid(), ${owner.id}, ${randomUUID()}, 'test fixture', 0, 'singleDevice', false) returning id
  `;
  const passkey = passkeys.at(firstRow);
  if (!passkey) {
    throw new Error('Missing fixture passkey');
  }

  await database.$client`update iam.sessions set admin_passkey_id = ${passkey.id}, admin_verified_at = now() where user_id = ${owner.id}`;
}

type Scenario = {
  owner: Actor;
  recipient: Actor;
  outsider: Actor;
  organizationId: string;
  outsiderOrganizationId: string;
};

async function inviteMember(database: Database, auth: Auth, scenario: Scenario): Promise<string> {
  const { owner, recipient, organizationId, outsiderOrganizationId } = scenario;
  const invite: Command = {
    action: 'invite',
    organizationId,
    email: recipient.email,
  };
  const unverifiedAdmin = await request(auth, invite, owner);
  expect(unverifiedAdmin.status).toBe(forbidden);
  expect(await unverifiedAdmin.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  await seedPasskey(database, owner);
  const foreignOrganization = await request(
    auth,
    {
      ...invite,
      organizationId: outsiderOrganizationId,
    },
    owner,
  );
  expect(foreignOrganization.status).toBe(forbidden);
  const created = await request(auth, invite, owner);
  expect(created.status).toBe(success);
  expect(await created.json()).toMatchObject({ notified: true });
  const pending = await request(
    auth,
    {
      action: 'list-pending',
      organizationId,
    },
    owner,
  );
  expect(pending.status).toBe(success);
  const invitations = await database.$client<{ id: string; role: string }[]>`
    select id, role from iam.invitations where organization_id = ${organizationId} and email = ${recipient.email}
  `;
  expect(invitations).toHaveLength(single);
  const invitation = invitations.at(firstRow);
  if (!invitation) {
    throw new Error('Invitation was not stored');
  }

  expect(invitation.role).toBe('member');
  expect(await pending.json()).toMatchObject({ items: [{ email: recipient.email }] });
  return invitation.id;
}

async function acceptMember(
  database: Database,
  auth: Auth,
  scenario: Scenario,
  invitationId: string,
): Promise<void> {
  const { recipient, outsider, organizationId } = scenario;
  const accept: Command = {
    action: 'accept',
    invitationId,
  };
  await database.$client`update iam.users set email_verified = false where id = ${recipient.id}`;
  const unverifiedEmail = await request(auth, accept, recipient);
  expect(unverifiedEmail.status).toBe(forbidden);
  const foreignRecipient = await request(auth, accept, outsider);
  expect(foreignRecipient.status).toBe(badRequest);
  const foreignList = await request(auth, { action: 'list-mine' }, outsider);
  expect(await foreignList.json()).toEqual({
    items: [],
    nextCursor: null,
  });
  await database.$client`update iam.users set email_verified = true where id = ${recipient.id}`;
  const list = await request(auth, { action: 'list-mine' }, recipient);
  expect(list.status).toBe(success);
  expect(await list.json()).toMatchObject({ items: [{ id: invitationId }] });
  const responses = await Promise.all([
    request(auth, accept, recipient),
    request(auth, accept, recipient),
  ]);
  expect(responses.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
    success,
    badRequest,
  ]);
  const memberships = await database.$client`
    select role from iam.members where organization_id = ${organizationId} and user_id = ${recipient.id}
  `;
  expect(memberships).toEqual([{ role: 'member' }]);
}

async function verifyCancellation(
  database: Database,
  auth: Auth,
  scenario: Scenario,
): Promise<void> {
  const { owner, outsider, organizationId } = scenario;
  const created = await request(
    auth,
    {
      action: 'invite',
      organizationId,
      email: outsider.email,
    },
    owner,
  );
  expect(created.status).toBe(success);
  const records = await database.$client<{ id: string }[]>`
    select id from iam.invitations where organization_id = ${organizationId} and email = ${outsider.email}
  `;
  const invitation = records.at(firstRow);
  if (!invitation) {
    throw new Error('Invitation to cancel was not stored');
  }

  const canceled = await request(
    auth,
    {
      action: 'cancel',
      organizationId,
      invitationId: invitation.id,
    },
    owner,
  );
  expect(canceled.status).toBe(success);
  const denied = await request(
    auth,
    {
      action: 'accept',
      invitationId: invitation.id,
    },
    outsider,
  );
  expect(denied.status).toBe(badRequest);
}

test.skipIf(!databasePort)(
  'invitations require admin MFA and verified recipients in the intended organization',
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
    const otherSlug = randomUUID();
    const emails = [
      `owner-${slug}@example.test`,
      `recipient-${slug}@example.test`,
      `outsider-${slug}@example.test`,
    ];
    const messages: Mail[] = [];
    const auth = createAuth(database, {
      secret: 'organization-invitations-integration-secret',
      url: origin,
      webOrigin: origin,
      sendOrganizationInvitation: async (mail) => {
        await setImmediate();
        messages.push(mail);
      },
    });

    try {
      const [owner, recipient, outsider] = await Promise.all(
        emails.map(async (email) => signUp(database, auth, email)),
      );
      const organization = await auth.api.createOrganization({
        body: {
          name: 'Invitation organization',
          slug,
          userId: owner.id,
        },
      });
      const outside = await auth.api.createOrganization({
        body: {
          name: 'Another organization',
          slug: otherSlug,
          userId: outsider.id,
        },
      });
      const scenario = {
        owner,
        recipient,
        outsider,
        organizationId: organization.id,
        outsiderOrganizationId: outside.id,
      };
      const invitationId = await inviteMember(database, auth, scenario);
      expect(messages).toEqual([
        {
          email: recipient.email,
          organizationName: organization.name,
        },
      ]);
      await acceptMember(database, auth, scenario, invitationId);
      await verifyCancellation(database, auth, scenario);
    } finally {
      try {
        await database.$client`delete from iam.organizations where slug in (${slug}, ${otherSlug})`;
        await database.$client`delete from iam.users where email in ${database.$client(emails)}`;
      } finally {
        await database.$client.end();
      }
    }
  },
);
