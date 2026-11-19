import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Page } from 'playwright';
import type { seedOidc } from './oidc.ts';
import { and, eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { expect } from 'vite-plus/test';
import { authorizationEvents } from '../../server/database/schema.ts';
import { assignAppRole } from '../../server/services/registration.service.ts';
import { authorizationUrl, exchange } from './oidc-protocol.ts';

type Fixture = Awaited<ReturnType<typeof seedOidc>>;

const VERIFIER_BYTES = 32;
const DENIED_CONSENTS = 2;

/**
 * Exercises consent for the second installation in an existing IdP session.
 * @param {Page} page - Browser with the fixture user's SSO cookie.
 * @param {Fixture} fixture - Member and installation registrations.
 * @param {string} callback - Exact redirect URI registered for the client.
 * @param {PostgresJsDatabase} reader - Connection authorized to read the audit tables.
 */
export async function checkInstallationConsent(
  page: Page,
  fixture: Fixture,
  callback: string,
  reader: PostgresJsDatabase,
): Promise<void> {
  const { south, userId } = fixture;
  const assignment = {
    organizationId: south.organizationId,
    clientId: south.clientId,
    userId,
  };
  const verifier = randomBytes(VERIFIER_BYTES).toString('base64url');
  const consent = page.getByRole('button', { name: 'Allow' });
  async function reviewRole(role: string): Promise<void> {
    await page.goto(authorizationUrl(south, callback, verifier).href);
    await consent.waitFor();
    await page
      .getByText(`You will sign in to Reports ${south.organizationId} with the role ${role}.`, {
        exact: true,
      })
      .waitFor();
  }

  await assignAppRole({
    ...assignment,
    role: 'auditor',
  });
  await reviewRole('auditor');

  await assignAppRole({
    ...assignment,
    role: 'publisher',
  });
  await consent.click();
  await page.getByRole('alert').waitFor();
  expect(new URL(page.url()).pathname).toBe('/consent');

  await reviewRole('publisher');
  await page.getByRole('button', { name: 'Deny' }).click();
  await page.waitForURL(`${callback}?**`);

  const denied = new URL(page.url());
  expect(denied.searchParams.get('error')).toBe('access_denied');
  expect(denied.searchParams.has('code')).toBe(false);

  await reviewRole('publisher');
  await consent.click();
  await page.waitForURL(`${callback}?**`);

  const code = new URL(page.url()).searchParams.get('code');
  assert.ok(code);
  const accepted = await exchange(south, callback, code, verifier);
  expect(accepted.ok).toBe(true);

  const events = await reader
    .select()
    .from(authorizationEvents)
    .where(
      and(
        eq(authorizationEvents.clientId, south.clientId),
        eq(authorizationEvents.userId, userId),
        eq(authorizationEvents.organizationId, south.organizationId),
      ),
    );

  expect(
    events.filter(({ stage, outcome }) => stage === 'consent' && outcome === 'denied'),
  ).toHaveLength(DENIED_CONSENTS);
  expect(events).toContainEqual(
    expect.objectContaining({
      stage: 'exchange',
      outcome: 'approved',
    }),
  );
}
