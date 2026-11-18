import { randomUUID } from 'node:crypto';
import { expect, test } from 'vite-plus/test';
import { createAuth } from '../../../packages/auth/src/utils/auth.ts';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';

const configuredIssuer = process.env.AUTH_WEB_TEST_URL;
const issuer = configuredIssuer ?? 'http://localhost:5173';
const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const authSecret = process.env.AUTH_SECRET;
const emptyLength = 0;
const pageSize = 30;
const success = 200;
const badRequest = 400;
const unauthorized = 401;
const forbidden = 403;
const notFound = 404;
const password = 'admin-passkey-integration-password';

type AdminTestAction =
  | { action: 'context' }
  | { action: 'begin-enrollment'; password: string }
  | { action: 'register-app'; organizationId: string; name: string; redirectUri: string }
  | { action: 'register-permissions'; installationId: string; permissionKeys: string[] }
  | { action: 'save-role'; installationId: string; role: { key: string; permissionKeys: string[] } }
  | {
      action: 'change-assignment';
      installationId: string;
      change:
        | { action: 'grant'; memberId: string; roleKeys: string[] }
        | { action: 'revoke'; memberId: string };
    };
type Database = ReturnType<typeof createDatabase>;
type AccessFixture = {
  organizationId: string;
  otherOrganizationId: string;
  installationId: string;
  otherInstallationId: string;
  memberId: string;
  otherMemberId: string;
};
type AccessRead =
  | { collection: 'apps'; organizationId: string }
  | { collection: 'members'; installationId: string; search?: string }
  | { collection: 'permissions' | 'roles'; installationId: string; cursor?: string };

async function adminRequest(
  body: AdminTestAction,
  cookie: string,
  origin = issuer,
): Promise<Response> {
  return fetch(`${issuer}/api/auth/admin/interaction`, {
    method: 'POST',
    headers: {
      origin,
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function readAccess(body: AccessRead, cookie: string, origin = issuer): Promise<Response> {
  return fetch(`${issuer}/api/auth/admin/access`, {
    method: 'POST',
    headers: {
      origin,
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function verifyReadRequiresPasskey(cookie: string, organizationId: string): Promise<void> {
  const query: AccessRead = {
    collection: 'apps',
    organizationId,
  };
  const passwordOnly = await readAccess(query, cookie);
  expect(passwordOnly.status).toBe(forbidden);
  expect(await passwordOnly.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  const foreignOrigin = await readAccess(query, cookie, 'https://another.example.test');
  expect(foreignOrigin.status).toBe(forbidden);
}

async function verifyEnrollmentBoundary(cookie: string): Promise<void> {
  const incorrect = await adminRequest(
    {
      action: 'begin-enrollment',
      password: 'incorrect password',
    },
    cookie,
  );
  expect(incorrect.status).toBe(badRequest);
  const begin = await adminRequest(
    {
      action: 'begin-enrollment',
      password,
    },
    cookie,
  );
  expect(begin.status).toBe(success);
  expect(begin.headers.get('cache-control')).toBe('no-store');
  expect(await begin.json()).toMatchObject({
    authenticatorSelection: { userVerification: 'required' },
  });
  const raw = await fetch(`${issuer}/api/auth/passkey/verify-registration`, { method: 'POST' });
  expect(raw.status).toBe(notFound);
}

async function verifyAdminBoundary(
  cookie: string,
  organization: { id: string; name: string },
): Promise<void> {
  const context = await adminRequest({ action: 'context' }, cookie);
  expect(context.status).toBe(success);
  expect(await context.json()).toEqual({
    enrolled: false,
    verified: false,
    organizations: [
      {
        id: organization.id,
        name: organization.name,
        owner: true,
      },
    ],
  });
  const denied = await adminRequest(
    {
      action: 'register-app',
      organizationId: organization.id,
      name: 'Denied registration',
      redirectUri: 'https://administration.example.test/callback',
    },
    cookie,
  );
  expect(denied.status).toBe(forbidden);
  expect(await denied.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  const deniedCatalog = await adminRequest(
    {
      action: 'register-permissions',
      installationId: randomUUID(),
      permissionKeys: ['reports.read'],
    },
    cookie,
  );
  expect(deniedCatalog.status).toBe(forbidden);
  expect(await deniedCatalog.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
  const anonymous = await adminRequest({ action: 'context' }, '');
  expect(anonymous.status).toBe(unauthorized);
  const foreign = await adminRequest({ action: 'context' }, cookie, 'https://another.example.test');
  expect(foreign.status).toBe(forbidden);
  await verifyEnrollmentBoundary(cookie);
}

async function provisionAccessFixture(
  database: Database,
  organizationId: string,
  otherSlug: string,
  userId: string,
): Promise<AccessFixture> {
  return database.$client.begin(async (transaction) => {
    const [{ id: otherOrganizationId }] = await transaction<{ id: string }[]>`
      insert into iam.organizations (id, name, slug, created_at)
      values (gen_random_uuid(), 'Unmanaged organization', ${otherSlug}, now()) returning id
    `;
    const [{ id: memberId }] = await transaction<{ id: string }[]>`
      select id from iam.members where organization_id = ${organizationId} and user_id = ${userId}
    `;
    const [{ id: otherMemberId }] = await transaction<{ id: string }[]>`
      insert into iam.members (id, organization_id, user_id, role, created_at)
      values (gen_random_uuid(), ${otherOrganizationId}, ${userId}, 'member', now()) returning id
    `;
    const [app, otherApp] = await transaction<{ id: string; organization_id: string }[]>`
      insert into iam.applications (id, organization_id, name)
      values (gen_random_uuid(), ${organizationId}, 'Managed app'),
             (gen_random_uuid(), ${otherOrganizationId}, 'Unmanaged app')
      returning id, organization_id
    `;
    const [{ id: installationId }, { id: otherInstallationId }] = await transaction<
      { id: string }[]
    >`
      insert into iam.app_installations (id, organization_id, application_id)
      values (gen_random_uuid(), ${app.organization_id}, ${app.id}),
             (gen_random_uuid(), ${otherApp.organization_id}, ${otherApp.id})
      returning id
    `;
    const [{ id: passkeyId }] = await transaction<{ id: string }[]>`
      insert into iam.passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up)
      values (gen_random_uuid(), ${userId}, ${randomUUID()}, 'test fixture', 0, 'singleDevice', false)
      returning id
    `;
    await transaction`update iam.sessions set admin_passkey_id = ${passkeyId}, admin_verified_at = now() where user_id = ${userId}`;
    return {
      organizationId,
      otherOrganizationId,
      installationId,
      otherInstallationId,
      memberId,
      otherMemberId,
    };
  });
}

async function verifyReadIsolation(cookie: string, fixture: AccessFixture): Promise<void> {
  const apps = await readAccess(
    {
      collection: 'apps',
      organizationId: fixture.organizationId,
    },
    cookie,
  );
  expect(apps.status).toBe(success);
  expect(apps.headers.get('cache-control')).toBe('no-store');
  expect(await apps.json()).toEqual({
    items: [
      {
        id: fixture.installationId,
        name: 'Managed app',
      },
    ],
    nextCursor: null,
  });
  const foreignApps = await readAccess(
    {
      collection: 'apps',
      organizationId: fixture.otherOrganizationId,
    },
    cookie,
  );
  expect(foreignApps.status).toBe(forbidden);
  const foreignMembers = await readAccess(
    {
      collection: 'members',
      installationId: fixture.otherInstallationId,
    },
    cookie,
  );
  expect(foreignMembers.status).toBe(forbidden);
  expect(await foreignMembers.json()).toMatchObject({ code: 'APP_ACCESS_FORBIDDEN' });
}

async function verifyPermissionPages(cookie: string, installationId: string): Promise<void> {
  const first = await readAccess(
    {
      collection: 'permissions',
      installationId,
    },
    cookie,
  );
  expect(first.status).toBe(success);
  const page: unknown = await first.json();
  expect(page).toMatchObject({ nextCursor: 'report-9.read' });
  expect(page).toHaveProperty('items.length', pageSize);
  const next = await readAccess(
    {
      collection: 'permissions',
      installationId,
      cursor: 'report-9.read',
    },
    cookie,
  );
  expect(next.status).toBe(success);
  expect(await next.json()).toEqual({
    items: [{ key: 'reports.read' }],
    nextCursor: null,
  });
}

async function verifyAssignmentRead(
  cookie: string,
  fixture: AccessFixture,
  email: string,
): Promise<void> {
  const { installationId, memberId } = fixture;
  const roles = await readAccess(
    {
      collection: 'roles',
      installationId,
    },
    cookie,
  );
  expect(roles.status).toBe(success);
  expect(await roles.json()).toEqual({
    items: [
      {
        key: 'reader',
        permissionKeys: ['reports.read'],
      },
    ],
    nextCursor: null,
  });
  const memberships = await readAccess(
    {
      collection: 'members',
      installationId,
      search: 'TEST ADMIN',
    },
    cookie,
  );
  expect(memberships.status).toBe(success);
  expect(await memberships.json()).toEqual({
    items: [
      {
        id: memberId,
        assigned: true,
        roleKeys: ['reader'],
        email,
        name: 'Test administrator',
      },
    ],
    nextCursor: null,
  });
}

async function verifyApplicationGovernance(
  cookie: string,
  fixture: AccessFixture,
  email: string,
): Promise<void> {
  const { installationId, otherInstallationId, memberId, otherMemberId } = fixture;
  const permissionKeys = ['reports.read'];
  const role = {
    key: 'reader',
    permissionKeys,
  };
  const foreignApp = await adminRequest(
    {
      action: 'register-permissions',
      installationId: otherInstallationId,
      permissionKeys,
    },
    cookie,
  );
  expect(foreignApp.status).toBe(forbidden);
  expect(await foreignApp.json()).toMatchObject({ code: 'APP_ACCESS_FORBIDDEN' });
  const unpublished = await adminRequest(
    {
      action: 'save-role',
      installationId,
      role,
    },
    cookie,
  );
  expect(unpublished.status).toBe(badRequest);
  expect(await unpublished.json()).toMatchObject({ code: 'APP_PERMISSION_NOT_FOUND' });
  const catalog = await adminRequest(
    {
      action: 'register-permissions',
      installationId,
      permissionKeys: [
        ...Array.from({ length: pageSize }, (_item, index) => `report-${index}.read`),
        ...permissionKeys,
      ],
    },
    cookie,
  );
  expect(catalog.status).toBe(success);
  await verifyPermissionPages(cookie, installationId);
  const saved = await adminRequest(
    {
      action: 'save-role',
      installationId,
      role,
    },
    cookie,
  );
  expect(saved.status).toBe(success);
  const foreignMember = await adminRequest(
    {
      action: 'change-assignment',
      installationId,
      change: {
        action: 'grant',
        memberId: otherMemberId,
        roleKeys: [role.key],
      },
    },
    cookie,
  );
  expect(foreignMember.status).toBe(badRequest);
  expect(await foreignMember.json()).toMatchObject({ code: 'APP_MEMBER_UNAVAILABLE' });
  const granted = await adminRequest(
    {
      action: 'change-assignment',
      installationId,
      change: {
        action: 'grant',
        memberId,
        roleKeys: [role.key],
      },
    },
    cookie,
  );
  expect(granted.status).toBe(success);
  await verifyAssignmentRead(cookie, fixture, email);
  const revoked = await adminRequest(
    {
      action: 'change-assignment',
      installationId,
      change: {
        action: 'revoke',
        memberId,
      },
    },
    cookie,
  );
  expect(revoked.status).toBe(success);
}

async function removeGovernanceFixture(database: Database, slugs: string[]): Promise<void> {
  await database.$client.begin(async (transaction) => {
    const installations = await transaction<{ id: string; application_id: string }[]>`
      select installation.id, installation.application_id from iam.app_installations installation
      join iam.organizations organization on organization.id = installation.organization_id
      where organization.slug in ${transaction(slugs)}
    `;

    if (installations.length === emptyLength) {
      return;
    }

    const installationIds = installations.map(({ id }) => id);
    const applicationIds = installations.map(({ application_id: applicationId }) => applicationId);
    await transaction`delete from iam.app_access_events where installation_id in ${transaction(installationIds)}`;
    await transaction`delete from iam.app_assignments where installation_id in ${transaction(installationIds)}`;
    await transaction`delete from iam.app_roles where installation_id in ${transaction(installationIds)}`;
    await transaction`delete from iam.app_permissions where application_id in ${transaction(applicationIds)}`;
    await transaction`delete from iam.app_installations where id in ${transaction(installationIds)}`;
    await transaction`delete from iam.applications where id in ${transaction(applicationIds)}`;
  });
}

test.skipIf(!configuredIssuer || !databasePort || !authSecret)(
  'administrator writes require a verified passkey and app governance stays in the owning organization',
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
    const otherSlug = `${slug}-other`;
    const email = `${slug}@example.test`;
    const auth = createAuth(database, {
      secret: authSecret ?? '',
      url: issuer,
      webOrigin: issuer,
    });

    try {
      const signup = await auth.api.signUpEmail({
        body: {
          name: 'Test administrator',
          email,
          password,
        },
      });
      const { user } = signup;
      await database.$client`update iam.users set email_verified = true where id = ${user.id}`;
      const signedIn = await auth.api.signInEmail({
        returnHeaders: true,
        body: { email, password },
      });
      const organization = await auth.api.createOrganization({
        body: {
          name: 'Admin test organization',
          slug,
          userId: user.id,
        },
      });
      const cookie = signedIn.headers
        .getSetCookie()
        .map((header) => header.split(';').shift())
        .join('; ');
      await verifyAdminBoundary(cookie, organization);
      await verifyReadRequiresPasskey(cookie, organization.id);
      const fixture = await provisionAccessFixture(database, organization.id, otherSlug, user.id);
      await verifyReadIsolation(cookie, fixture);
      await verifyApplicationGovernance(cookie, fixture, email);
      const events = await database.$client<{ action: string }[]>`
        select action from iam.app_access_events where installation_id = ${fixture.installationId}
        and actor_id = ${user.id} order by created_at, id
      `;
      expect(events.map(({ action }) => action)).toEqual([
        'permissions.registered',
        'role.saved',
        'assignment.granted',
        'assignment.revoked',
      ]);
    } finally {
      try {
        await removeGovernanceFixture(database, [slug, otherSlug]);
        await database.$client`delete from iam.organizations where slug in (${slug}, ${otherSlug})`;
        await database.$client`
          delete from iam.rate_limits where key in (
            select 'iam:admin-password-check:' || id::text from iam.users where email = ${email}
          )
        `;
        await database.$client`delete from iam.users where email = ${email}`;
      } finally {
        await database.$client.end();
      }
    }
  },
);
