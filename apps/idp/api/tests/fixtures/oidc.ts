import { hashPassword } from 'better-auth/crypto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { useDatabase } from '../../server/database/index.ts';
import { accounts, memberships, organizations, users } from '../../server/database/schema.ts';
import { assignAppRole, provisionClient } from '../../server/services/registration.service.ts';
import { useAuth } from '../../server/utils/auth.ts';
import { verifyConsoleAccess } from './console-client.ts';

type Registration = Awaited<ReturnType<typeof provisionClient>>;
type Installation = Registration & { organizationId: string };
type Fixture = {
  north: Installation;
  south: Installation;
  email: string;
  password: string;
  userId: string;
};

async function install(headers: Headers, userId: string, callback: string): Promise<Installation> {
  const database = useDatabase();
  const organizationId = randomUUID();
  const name = `Reports ${organizationId}`;
  const createdAt = new Date();

  await database.insert(organizations).values({
    id: organizationId,
    slug: organizationId,
    name,
    createdAt,
  });
  await database.insert(memberships).values({
    organizationId,
    userId,
    role: 'member',
    createdAt,
  });

  const client = await provisionClient(headers, {
    kind: 'installation',
    name: 'Reports',
    redirectUris: [callback],
    organizationId,
  });

  return { ...client, organizationId };
}

/**
 * Creates a verified user in two organizations and assigns Reports access in the first.
 * @param {string} callback - HTTPS callback accepted by both fixture clients.
 * @returns {Promise<Fixture>} Credentials and tenant registrations for the browser flow.
 */
export async function seedOidc(callback: string): Promise<Fixture> {
  const database = useDatabase();
  const auth = useAuth();
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  const password = randomUUID();
  const digest = await hashPassword(password);

  await database.insert(users).values({
    id: userId,
    name: 'OIDC fixture',
    email,
    emailVerified: true,
  });
  await database.insert(accounts).values({
    userId,
    accountId: userId,
    providerId: 'credential',
    password: digest,
  });

  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';').shift())
    .join('; ');

  assert.ok(cookie);
  const headers = new Headers({ cookie });

  await verifyConsoleAccess(headers, callback);

  const north = await install(headers, userId, callback);
  const south = await install(headers, userId, callback);

  await assignAppRole({
    userId,
    organizationId: north.organizationId,
    clientId: north.clientId,
    role: 'reader',
  });
  return { north, south, userId, email, password };
}
